use crate::app_paths;
use crate::contracts::{
    ApiConnectionAgentRecord, ApiConnectionRecord, ApiConnectionStatus, ApiConnectionType,
};
use crate::secrets::{redacted_error, AppSecretStore, SecretKey, SecretStore, SecretValue};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tokio::time::Duration;
use uuid::Uuid;

const API_REGISTRY_ENV_PATH: &str = "ARXELL_API_REGISTRY_PATH";
const API_REGISTRY_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct NewApiConnectionInput {
    pub api_type: ApiConnectionType,
    pub api_url: String,
    pub name: Option<String>,
    pub api_key: String,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub api_standard_path: Option<String>,
    pub allow_plaintext_fallback: bool,
}

#[derive(Debug, Clone)]
pub struct UpdateApiConnectionInput {
    pub api_type: Option<ApiConnectionType>,
    pub api_url: Option<String>,
    pub name: Option<String>,
    pub api_key: Option<String>,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub api_standard_path: Option<String>,
    pub allow_plaintext_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiConnectionSecretRecord {
    id: String,
    api_type: ApiConnectionType,
    api_url: String,
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    model_name: Option<String>,
    cost_per_month_usd: Option<f64>,
    status: ApiConnectionStatus,
    status_message: String,
    last_checked_ms: Option<i64>,
    created_ms: i64,
    api_standard_path: Option<String>,
    #[serde(default)]
    available_models: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ApiRegistrySnapshot {
    version: u32,
    connections: Vec<ApiConnectionSecretRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionPortableRecord {
    pub id: Option<String>,
    pub api_type: ApiConnectionType,
    pub api_url: String,
    pub name: Option<String>,
    pub api_key: String,
    pub model_name: Option<String>,
    pub cost_per_month_usd: Option<f64>,
    pub api_standard_path: Option<String>,
    pub created_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConnectionsPortableSnapshot {
    pub version: u32,
    pub exported_at_ms: i64,
    pub connections: Vec<ApiConnectionPortableRecord>,
}

pub struct ApiRegistryService {
    connections: RwLock<HashMap<String, ApiConnectionSecretRecord>>,
    registry_path: PathBuf,
    secret_store: Arc<AppSecretStore>,
}

#[derive(Debug, Clone)]
pub struct ApiEndpointProbeResult {
    pub detected_api_type: ApiConnectionType,
    pub api_standard_path: Option<String>,
    pub verify_url: String,
    pub models: Vec<String>,
    pub selected_model: Option<String>,
    pub status: ApiConnectionStatus,
    pub status_message: String,
}

impl ApiRegistryService {
    pub fn new() -> Self {
        let registry_path = default_registry_path();
        let app_data_root = registry_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| {
                default_app_data_root().unwrap_or_else(|| std::env::temp_dir().join("arxell"))
            });
        let secret_store = Arc::new(AppSecretStore::new(app_data_root));
        let snapshot = read_registry_snapshot(&registry_path);
        let mut connections = HashMap::new();
        let mut migrated_any = false;
        for mut record in snapshot.connections {
            if let Some(api_key) = record.api_key.as_deref() {
                if !api_key.trim().is_empty()
                    && !appears_masked_api_key(api_key)
                    && secret_store
                        .set_secret(
                            &SecretKey::api_connection(record.id.as_str()),
                            &SecretValue::new(api_key.to_string()),
                        )
                        .is_ok()
                {
                    record.api_key = None;
                    migrated_any = true;
                }
            }
            if record
                .api_key
                .as_deref()
                .map(appears_masked_api_key)
                .unwrap_or(false)
            {
                record.status = ApiConnectionStatus::Warning;
                record.status_message =
                    "Stored API key appears masked. Re-enter the full API key and verify again."
                        .to_string();
                record.last_checked_ms = Some(now_ms());
            } else if record.api_key.is_some() && !secret_store.is_available() {
                record.status = ApiConnectionStatus::Warning;
                record.status_message = "Secure credential storage is unavailable. Existing plaintext key was not migrated; save this connection after acknowledging plaintext fallback or enable an OS keychain.".to_string();
                record.last_checked_ms = Some(now_ms());
            }
            connections.insert(record.id.clone(), record);
        }
        let service = Self {
            connections: RwLock::new(connections),
            registry_path,
            secret_store,
        };
        if migrated_any {
            let connections = service
                .connections
                .read()
                .expect("api registry lock poisoned");
            let _ = service.persist_snapshot(&connections);
        }
        service
    }

    pub fn list(&self) -> Vec<ApiConnectionRecord> {
        let connections = self.connections.read().expect("api registry lock poisoned");
        let mut records: Vec<_> = connections.values().map(to_public_record).collect();
        records.sort_by(|a, b| {
            b.created_ms
                .cmp(&a.created_ms)
                .then_with(|| a.id.cmp(&b.id))
        });
        records
    }

    pub async fn create_and_verify(
        &self,
        input: NewApiConnectionInput,
    ) -> Result<ApiConnectionRecord, String> {
        let api_url = normalize_required(input.api_url.as_str(), "apiUrl")?;
        validate_url(api_url.as_str())?;
        let api_key = normalize_api_key(input.api_key.as_str());
        validate_api_key(api_key.as_str())?;
        let name = normalize_optional(input.name.as_deref());
        let model_name = normalize_optional(input.model_name.as_deref());
        let cost = normalize_cost(input.cost_per_month_usd)?;
        let api_standard_path = normalize_optional(input.api_standard_path.as_deref());
        if input.allow_plaintext_fallback {
            self.secret_store.acknowledge_plaintext_fallback();
        }
        let id = format!("api-{}", Uuid::new_v4());
        self.store_api_key(id.as_str(), api_key.as_str())?;

        let record = ApiConnectionSecretRecord {
            id,
            api_type: input.api_type,
            api_url,
            name,
            api_key: None,
            model_name,
            cost_per_month_usd: cost,
            status: ApiConnectionStatus::Pending,
            status_message: "Saved. Verification pending.".to_string(),
            last_checked_ms: None,
            created_ms: now_ms(),
            api_standard_path,
            available_models: Vec::new(),
        };

        {
            let mut connections = self
                .connections
                .write()
                .expect("api registry lock poisoned");
            connections.insert(record.id.clone(), record.clone());
            self.persist_snapshot(&connections)?;
        }

        Ok(to_public_record(&record))
    }

    pub async fn reverify(&self, id: &str) -> Result<ApiConnectionRecord, String> {
        let mut existing = {
            let connections = self.connections.read().expect("api registry lock poisoned");
            connections
                .get(id)
                .cloned()
                .ok_or_else(|| format!("api connection not found: {id}"))?
        };

        let api_key = self.record_api_key(&existing)?;
        let (status, status_message) = verify_connection(
            existing.api_type.clone(),
            existing.api_url.as_str(),
            Some(api_key.as_str()),
            existing.api_standard_path.as_deref(),
            existing.model_name.as_deref(),
        )
        .await;
        let available_models = discover_available_models(
            existing.api_type.clone(),
            existing.api_url.as_str(),
            api_key.as_str(),
            existing.api_standard_path.as_deref(),
        )
        .await;
        existing.status = status;
        existing.status_message = status_message;
        existing.last_checked_ms = Some(now_ms());
        existing.available_models = available_models;

        {
            let mut connections = self
                .connections
                .write()
                .expect("api registry lock poisoned");
            connections.insert(existing.id.clone(), existing.clone());
            self.persist_snapshot(&connections)?;
        }

        Ok(to_public_record(&existing))
    }

    pub fn update(
        &self,
        id: &str,
        input: UpdateApiConnectionInput,
    ) -> Result<ApiConnectionRecord, String> {
        let mut existing = {
            let connections = self.connections.read().expect("api registry lock poisoned");
            connections
                .get(id)
                .cloned()
                .ok_or_else(|| format!("api connection not found: {id}"))?
        };

        // Update fields if provided
        if let Some(api_url) = input.api_url {
            let normalized = normalize_required(api_url.as_str(), "apiUrl")?;
            validate_url(normalized.as_str())?;
            existing.api_url = normalized;
        }
        if let Some(name) = input.name {
            existing.name = normalize_optional(Some(name.as_str()));
        }
        if let Some(api_key) = input.api_key {
            let normalized = normalize_api_key(api_key.as_str());
            validate_api_key(normalized.as_str())?;
            if input.allow_plaintext_fallback {
                self.secret_store.acknowledge_plaintext_fallback();
            }
            self.store_api_key(existing.id.as_str(), normalized.as_str())?;
            existing.api_key = None;
        }
        if let Some(model_name) = input.model_name {
            existing.model_name = normalize_optional(Some(model_name.as_str()));
        }
        if let Some(cost) = input.cost_per_month_usd {
            existing.cost_per_month_usd = normalize_cost(Some(cost))?;
        }
        if let Some(api_type) = input.api_type {
            existing.api_type = api_type;
        }
        if let Some(api_standard_path) = input.api_standard_path {
            existing.api_standard_path = normalize_optional(Some(api_standard_path.as_str()));
        }
        existing.status = ApiConnectionStatus::Pending;
        existing.status_message = "Saved. Verification pending.".to_string();
        existing.last_checked_ms = None;

        // Persist the updated record
        {
            let mut connections = self
                .connections
                .write()
                .expect("api registry lock poisoned");
            connections.insert(existing.id.clone(), existing.clone());
            self.persist_snapshot(&connections)?;
        }

        Ok(to_public_record(&existing))
    }

    pub fn get_secret_api_key(&self, id: &str) -> Result<String, String> {
        let connections = self.connections.read().expect("api registry lock poisoned");
        let record = connections
            .get(id)
            .ok_or_else(|| format!("api connection not found: {id}"))?;
        self.record_api_key(record)
    }

    pub fn export_portable_snapshot_json(&self) -> Result<String, String> {
        let connections = self.connections.read().expect("api registry lock poisoned");
        let mut portable: Vec<_> = connections
            .values()
            .map(|record| {
                Ok(ApiConnectionPortableRecord {
                    id: Some(record.id.clone()),
                    api_type: record.api_type.clone(),
                    api_url: record.api_url.clone(),
                    name: record.name.clone(),
                    api_key: self.record_api_key(record)?,
                    model_name: record.model_name.clone(),
                    cost_per_month_usd: record.cost_per_month_usd,
                    api_standard_path: record.api_standard_path.clone(),
                    created_ms: Some(record.created_ms),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        portable.sort_by(|a, b| {
            b.created_ms
                .unwrap_or(0)
                .cmp(&a.created_ms.unwrap_or(0))
                .then_with(|| a.api_url.cmp(&b.api_url))
        });
        let snapshot = ApiConnectionsPortableSnapshot {
            version: API_REGISTRY_VERSION,
            exported_at_ms: now_ms(),
            connections: portable,
        };
        let payload = serde_json::to_string_pretty(&snapshot)
            .map_err(|e| format!("failed serializing api registry export: {e}"))?;
        Ok(format!("{payload}\n"))
    }

    pub fn import_portable_snapshot_json(
        &self,
        payload_json: &str,
        allow_plaintext_fallback: bool,
    ) -> Result<Vec<ApiConnectionRecord>, String> {
        if allow_plaintext_fallback {
            self.secret_store.acknowledge_plaintext_fallback();
        }
        let imported = parse_portable_import(payload_json)?;
        if imported.is_empty() {
            return Ok(self.list());
        }

        let mut connections = self
            .connections
            .write()
            .expect("api registry lock poisoned");
        for item in imported {
            let api_url = normalize_required(item.api_url.as_str(), "apiUrl")?;
            validate_url(api_url.as_str())?;
            let api_key = normalize_api_key(item.api_key.as_str());
            validate_api_key(api_key.as_str())?;
            let created_ms = item.created_ms.unwrap_or_else(now_ms);
            let id = item
                .id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| format!("api-{}", Uuid::new_v4()));

            let existing = connections.get(&id);
            let status = existing
                .map(|record| record.status.clone())
                .unwrap_or(ApiConnectionStatus::Pending);
            let status_message = existing
                .map(|record| record.status_message.clone())
                .unwrap_or_else(|| "Imported connection. Verify to confirm status.".to_string());
            let last_checked_ms = existing.and_then(|record| record.last_checked_ms);
            let available_models = existing
                .map(|record| record.available_models.clone())
                .unwrap_or_default();

            self.store_api_key(id.as_str(), api_key.as_str())?;

            let record = ApiConnectionSecretRecord {
                id: id.clone(),
                api_type: item.api_type,
                api_url,
                name: normalize_optional(item.name.as_deref()),
                api_key: None,
                model_name: normalize_optional(item.model_name.as_deref()),
                cost_per_month_usd: normalize_cost(item.cost_per_month_usd)?,
                status,
                status_message,
                last_checked_ms,
                created_ms,
                api_standard_path: normalize_optional(item.api_standard_path.as_deref()),
                available_models,
            };
            connections.insert(id, record);
        }
        self.persist_snapshot(&connections)?;
        let mut out: Vec<_> = connections.values().map(to_public_record).collect();
        out.sort_by(|a, b| {
            b.created_ms
                .cmp(&a.created_ms)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let mut connections = self
            .connections
            .write()
            .expect("api registry lock poisoned");
        let deleted = connections.remove(id).is_some();
        let _ = self
            .secret_store
            .delete_secret(&SecretKey::api_connection(id));
        self.persist_snapshot(&connections)?;
        Ok(deleted)
    }

    pub fn verified_for_agent(&self) -> Vec<ApiConnectionAgentRecord> {
        let connections = self.connections.read().expect("api registry lock poisoned");
        let mut records: Vec<_> = connections
            .values()
            .filter(|record| record.status == ApiConnectionStatus::Verified)
            .filter_map(|record| {
                let api_key = self.record_api_key(record).ok()?;
                Some(ApiConnectionAgentRecord {
                    id: record.id.clone(),
                    api_type: record.api_type.clone(),
                    api_url: record.api_url.clone(),
                    name: record.name.clone(),
                    api_key,
                    model_name: record.model_name.clone(),
                    cost_per_month_usd: record.cost_per_month_usd,
                    api_standard_path: record.api_standard_path.clone(),
                })
            })
            .collect();
        records.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        records
    }

    pub fn primary_verified_search_for_agent(&self) -> Option<ApiConnectionAgentRecord> {
        let connections = self.connections.read().expect("api registry lock poisoned");
        let mut candidates: Vec<_> = connections
            .values()
            .filter(|record| {
                record.status == ApiConnectionStatus::Verified
                    && matches!(record.api_type, ApiConnectionType::Search)
            })
            .cloned()
            .collect();
        candidates.sort_by(|a, b| {
            b.created_ms
                .cmp(&a.created_ms)
                .then_with(|| a.id.cmp(&b.id))
        });
        candidates.into_iter().next().and_then(|record| {
            let api_key = self.record_api_key(&record).ok()?;
            Some(ApiConnectionAgentRecord {
                id: record.id,
                api_type: record.api_type,
                api_url: record.api_url,
                name: record.name,
                api_key,
                model_name: record.model_name,
                cost_per_month_usd: record.cost_per_month_usd,
                api_standard_path: record.api_standard_path,
            })
        })
    }

    fn store_api_key(&self, id: &str, api_key: &str) -> Result<(), String> {
        self.secret_store
            .set_secret(
                &SecretKey::api_connection(id),
                &SecretValue::new(api_key.to_string()),
            )
            .map_err(redacted_error)
    }

    fn record_api_key(&self, record: &ApiConnectionSecretRecord) -> Result<String, String> {
        if let Some(api_key) = record.api_key.as_deref() {
            return Ok(api_key.to_string());
        }
        self.secret_store
            .get_secret(&SecretKey::api_connection(record.id.as_str()))
            .map_err(redacted_error)?
            .map(SecretValue::expose)
            .ok_or_else(|| "API key is not available in credential storage".to_string())
    }

    fn persist_snapshot(
        &self,
        connections: &HashMap<String, ApiConnectionSecretRecord>,
    ) -> Result<(), String> {
        let Some(parent) = self.registry_path.parent() else {
            return Err("invalid api registry path".to_string());
        };
        fs::create_dir_all(parent).map_err(|e| format!("failed creating api registry dir: {e}"))?;
        let mut snapshot = ApiRegistrySnapshot {
            version: API_REGISTRY_VERSION,
            connections: connections.values().cloned().collect(),
        };
        snapshot.connections.sort_by(|a, b| {
            b.created_ms
                .cmp(&a.created_ms)
                .then_with(|| a.id.cmp(&b.id))
        });

        let payload = serde_json::to_string_pretty(&snapshot)
            .map_err(|e| format!("failed serializing api registry: {e}"))?;
        let tmp_path = self.registry_path.with_extension("json.tmp");
        fs::write(&tmp_path, format!("{payload}\n"))
            .map_err(|e| format!("failed writing api registry snapshot: {e}"))?;
        fs::rename(&tmp_path, &self.registry_path)
            .map_err(|e| format!("failed replacing api registry snapshot: {e}"))?;
        Ok(())
    }

    pub async fn probe_endpoint(
        &self,
        api_url: &str,
        api_type: Option<ApiConnectionType>,
        api_key: Option<&str>,
        api_standard_path: Option<&str>,
    ) -> Result<ApiEndpointProbeResult, String> {
        let normalized_url = normalize_required(api_url, "apiUrl")?;
        validate_url(normalized_url.as_str())?;
        let normalized_key = normalize_api_key(api_key.unwrap_or(""));
        validate_api_key(normalized_key.as_str())?;

        let requested_type = api_type.unwrap_or(ApiConnectionType::Llm);
        if matches!(requested_type, ApiConnectionType::Search) {
            let verify_url = build_verify_url(
                ApiConnectionType::Search,
                normalized_url.as_str(),
                api_standard_path,
            );
            let (status, status_message) = verify_connection(
                ApiConnectionType::Search,
                normalized_url.as_str(),
                Some(normalized_key.as_str()),
                api_standard_path,
                None,
            )
            .await;
            return Ok(ApiEndpointProbeResult {
                detected_api_type: ApiConnectionType::Search,
                api_standard_path: api_standard_path
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(ToOwned::to_owned),
                verify_url,
                models: Vec::new(),
                selected_model: None,
                status,
                status_message,
            });
        }

        let client =
            build_http_client().map_err(|e| format!("Failed to create HTTP client: {e}"))?;
        let model_probe = probe_openai_models(
            &client,
            normalized_url.as_str(),
            normalized_key.as_str(),
            api_standard_path,
        )
        .await;

        if let Some(result) = model_probe {
            return Ok(result);
        }

        let detected_path = api_standard_path
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| detect_chat_path_from_base(normalized_url.as_str()));
        let verify_url = build_verify_url(
            ApiConnectionType::Llm,
            normalized_url.as_str(),
            detected_path.as_deref(),
        );
        let (status, status_message) = verify_connection(
            ApiConnectionType::Llm,
            normalized_url.as_str(),
            Some(normalized_key.as_str()),
            detected_path.as_deref(),
            None,
        )
        .await;

        Ok(ApiEndpointProbeResult {
            detected_api_type: ApiConnectionType::Llm,
            api_standard_path: detected_path,
            verify_url,
            models: Vec::new(),
            selected_model: None,
            status,
            status_message,
        })
    }
}

impl Default for ApiRegistryService {
    fn default() -> Self {
        Self::new()
    }
}

fn to_public_record(record: &ApiConnectionSecretRecord) -> ApiConnectionRecord {
    let api_key_prefix = record
        .api_key
        .as_deref()
        .map(api_key_prefix)
        .unwrap_or_default();
    ApiConnectionRecord {
        id: record.id.clone(),
        api_type: record.api_type.clone(),
        api_url: record.api_url.clone(),
        name: record.name.clone(),
        api_key_masked: if api_key_prefix.is_empty() {
            "********".to_string()
        } else {
            mask_api_key(record.api_key.as_deref().unwrap_or_default())
        },
        api_key_prefix,
        model_name: record.model_name.clone(),
        cost_per_month_usd: record.cost_per_month_usd,
        status: record.status.clone(),
        status_message: record.status_message.clone(),
        last_checked_ms: record.last_checked_ms,
        created_ms: record.created_ms,
        api_standard_path: record.api_standard_path.clone(),
        available_models: record.available_models.clone(),
    }
}

fn api_key_prefix(api_key: &str) -> String {
    api_key.trim().chars().take(8).collect::<String>()
}

fn mask_api_key(api_key: &str) -> String {
    let prefix = api_key_prefix(api_key);
    if prefix.is_empty() {
        "(none)".to_string()
    } else {
        format!("{prefix}******")
    }
}

async fn discover_available_models(
    api_type: ApiConnectionType,
    api_url: &str,
    api_key: &str,
    api_standard_path: Option<&str>,
) -> Vec<String> {
    if !matches!(api_type, ApiConnectionType::Llm) {
        return Vec::new();
    }
    let Ok(client) = build_http_client() else {
        return Vec::new();
    };
    probe_openai_models(&client, api_url, api_key, api_standard_path)
        .await
        .map(|result| result.models)
        .unwrap_or_default()
}

fn validate_api_key(api_key: &str) -> Result<(), String> {
    if appears_masked_api_key(api_key) {
        return Err(
            "apiKey appears to be masked (contains ***). Paste the full raw key, not the table preview."
                .to_string(),
        );
    }
    Ok(())
}

fn normalize_api_key(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_required(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(normalized.to_string())
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_cost(value: Option<f64>) -> Result<Option<f64>, String> {
    match value {
        Some(cost) if !cost.is_finite() => Err("costPerMonthUsd must be finite".to_string()),
        Some(cost) if cost < 0.0 => Err("costPerMonthUsd must be >= 0".to_string()),
        Some(cost) => Ok(Some((cost * 100.0).round() / 100.0)),
        None => Ok(None),
    }
}

fn validate_url(api_url: &str) -> Result<(), String> {
    if api_url.starts_with("http://") || api_url.starts_with("https://") {
        return Ok(());
    }
    Err("apiUrl must start with http:// or https://".to_string())
}

async fn verify_connection(
    api_type: ApiConnectionType,
    api_url: &str,
    api_key: Option<&str>,
    api_standard_path: Option<&str>,
    model_name: Option<&str>,
) -> (ApiConnectionStatus, String) {
    let api_key = api_key.unwrap_or("").trim();
    if appears_masked_api_key(api_key) {
        return (
            ApiConnectionStatus::Warning,
            "Verification skipped: API key appears masked. Paste the full raw key and verify again."
                .to_string(),
        );
    }

    let client = match build_http_client() {
        Ok(client) => client,
        Err(error) => {
            return (
                ApiConnectionStatus::Warning,
                format!("Failed to create HTTP client: {error}"),
            )
        }
    };

    let verify_url = build_verify_url(api_type.clone(), api_url, api_standard_path);

    let request = match api_type {
        ApiConnectionType::Search => with_auth_headers(
            client
                .post(&verify_url)
                .header("User-Agent", app_paths::APP_USER_AGENT)
                .header("Content-Type", "application/json"),
            api_key,
        )
        .json(&serde_json::json!({"q":"test","num":1})),
        _ => {
            let selected_model = model_name.map(str::trim).filter(|v| !v.is_empty());
            let body = if let Some(model) = selected_model {
                serde_json::json!({
                    "model": model,
                    "messages": [
                        {"role":"system","content":"You are a helpful AI assistant."},
                        {"role":"user","content":"Hello, please introduce yourself."}
                    ],
                    "temperature": 1.0,
                    "stream": true
                })
            } else {
                serde_json::json!({
                    "messages": [
                        {"role":"system","content":"You are a helpful AI assistant."},
                        {"role":"user","content":"Hello, please introduce yourself."}
                    ],
                    "temperature": 1.0,
                    "stream": true
                })
            };
            with_auth_headers(
                client
                    .post(&verify_url)
                    .header("User-Agent", app_paths::APP_USER_AGENT)
                    .header("Accept-Language", "en-US,en")
                    .header("Content-Type", "application/json"),
                api_key,
            )
            .json(&body)
        }
    };

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let headers = response.headers().clone();
            let body_text = response.text().await.unwrap_or_default();
            if status.is_success() {
                (
                    ApiConnectionStatus::Verified,
                    format!(
                        "Verified {} endpoint at {} (HTTP {})",
                        api_type_label(&api_type),
                        verify_url,
                        status_code
                    ),
                )
            } else {
                let model_list_reachable = if matches!(api_type, ApiConnectionType::Llm) {
                    probe_openai_models(&client, api_url, api_key, api_standard_path)
                        .await
                        .is_some()
                } else {
                    false
                };
                if status_code == 429 {
                    if looks_like_exhausted_rate_limit(&headers, body_text.as_str()) {
                        (
                            ApiConnectionStatus::Warning,
                            format!(
                                "Connection reachable at {} but verification is blocked by exhausted rate/quota limits (HTTP 429)",
                                verify_url
                            ),
                        )
                    } else if model_list_reachable {
                        (
                            ApiConnectionStatus::Verified,
                            format!(
                                "Connection reachable at {}. Chat verify returned HTTP 429, but models/auth probe succeeded.",
                                verify_url
                            ),
                        )
                    } else {
                        (
                            ApiConnectionStatus::Verified,
                            format!(
                                "Connection reachable at {} (HTTP 429). Limit policy detected but not confirmed as exhausted.",
                                verify_url
                            ),
                        )
                    }
                } else if model_list_reachable {
                    (
                        ApiConnectionStatus::Verified,
                        format!(
                            "Connection reachable at {}. Chat verify returned HTTP {}, but models/auth probe succeeded.",
                            verify_url, status_code
                        ),
                    )
                } else {
                    (
                        ApiConnectionStatus::Warning,
                        format!(
                            "Connection reachable at {} but verification failed (HTTP {})",
                            verify_url, status_code
                        ),
                    )
                }
            }
        }
        Err(error) => (
            ApiConnectionStatus::Warning,
            format!("Connection test failed: {error}"),
        ),
    }
}

fn looks_like_exhausted_rate_limit(headers: &reqwest::header::HeaderMap, body_text: &str) -> bool {
    let body = body_text.to_ascii_lowercase();
    let body_has_exhausted_signal = (body.contains("rate limit")
        || body.contains("ratelimit")
        || body.contains("quota")
        || body.contains("insufficient_quota"))
        && (body.contains("exceed")
            || body.contains("exhaust")
            || body.contains("limit reached")
            || body.contains("too many requests")
            || body.contains("insufficient_quota"));
    if body_has_exhausted_signal {
        return true;
    }

    let remaining_headers = [
        "x-ratelimit-remaining",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-remaining-tokens",
    ];
    for key in remaining_headers {
        if let Some(value) = headers.get(key).and_then(|v| v.to_str().ok()) {
            if value.trim() == "0" {
                return true;
            }
        }
    }
    false
}

fn build_http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(12))
        .build()
}

fn with_auth_headers(
    mut builder: reqwest::RequestBuilder,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let trimmed = api_key.trim();
    if !trimmed.is_empty() {
        builder = builder
            .header("Authorization", format!("Bearer {trimmed}"))
            .header("x-api-key", trimmed);
    }
    builder
}

async fn probe_openai_models(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &str,
    api_standard_path: Option<&str>,
) -> Option<ApiEndpointProbeResult> {
    let mut candidates = candidate_model_list_urls(api_url);
    if candidates.is_empty() {
        return None;
    }
    candidates.dedup();

    for models_url in candidates {
        let request = with_auth_headers(client.get(models_url.as_str()), api_key)
            .header("User-Agent", app_paths::APP_USER_AGENT)
            .header("Accept", "application/json");
        let Ok(response) = request.send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let status_code = response.status().as_u16();
        let body: serde_json::Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));
        let models = extract_model_ids(body);
        let selected_model = models.first().cloned();
        let detected_path = api_standard_path
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| detect_chat_path_from_models_url(models_url.as_str()));
        let verify_url =
            build_verify_url(ApiConnectionType::Llm, api_url, detected_path.as_deref());
        let message = if models.is_empty() {
            format!(
                "Detected OpenAI-compatible endpoint at {} (HTTP {})",
                models_url, status_code
            )
        } else {
            format!(
                "Detected OpenAI-compatible endpoint with {} model(s) at {} (HTTP {})",
                models.len(),
                models_url,
                status_code
            )
        };
        return Some(ApiEndpointProbeResult {
            detected_api_type: ApiConnectionType::Llm,
            api_standard_path: detected_path,
            verify_url,
            models,
            selected_model,
            status: ApiConnectionStatus::Verified,
            status_message: message,
        });
    }
    None
}

fn candidate_model_list_urls(api_url: &str) -> Vec<String> {
    let base = api_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Vec::new();
    }

    if base.ends_with("/models") {
        return vec![base.to_string()];
    }

    if base.ends_with("/v1") {
        let root = base.trim_end_matches("/v1").trim_end_matches('/');
        return vec![format!("{base}/models"), format!("{root}/models")];
    }

    vec![format!("{base}/v1/models"), format!("{base}/models")]
}

fn detect_chat_path_from_models_url(models_url: &str) -> Option<String> {
    let lower = models_url.to_ascii_lowercase();
    if lower.ends_with("/v1/models") {
        return Some("/v1/chat/completions".to_string());
    }
    if lower.ends_with("/models") {
        return Some("/chat/completions".to_string());
    }
    None
}

fn detect_chat_path_from_base(api_url: &str) -> Option<String> {
    let base = api_url.trim().trim_end_matches('/').to_ascii_lowercase();
    if base.ends_with("/v1") {
        return Some("/chat/completions".to_string());
    }
    if base.ends_with("/v1/chat/completions") || base.ends_with("/chat/completions") {
        return None;
    }
    Some("/v1/chat/completions".to_string())
}

fn extract_model_ids(value: serde_json::Value) -> Vec<String> {
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    if let Some(data) = value.get("data").and_then(|v| v.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let trimmed = id.trim();
                if !trimmed.is_empty() {
                    let owned = trimmed.to_string();
                    if seen.insert(owned.clone()) {
                        models.push(owned);
                    }
                }
            }
        }
    }
    if models.is_empty() {
        if let Some(items) = value.get("models").and_then(|v| v.as_array()) {
            for item in items {
                if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                    let trimmed = id.trim();
                    if !trimmed.is_empty() {
                        let owned = trimmed.to_string();
                        if seen.insert(owned.clone()) {
                            models.push(owned);
                        }
                        continue;
                    }
                }
                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                    let trimmed = name.trim();
                    if !trimmed.is_empty() {
                        let owned = trimmed.to_string();
                        if seen.insert(owned.clone()) {
                            models.push(owned);
                        }
                    }
                }
            }
        }
    }
    models
}

fn build_verify_url(
    api_type: ApiConnectionType,
    api_url: &str,
    api_standard_path: Option<&str>,
) -> String {
    let base = api_url.trim().trim_end_matches('/');
    let default_path = match api_type {
        ApiConnectionType::Search => "/search",
        _ => "/chat/completions",
    };
    let verify_path = api_standard_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or(default_path);

    if verify_path.starts_with("http://") || verify_path.starts_with("https://") {
        return verify_path.to_string();
    }

    if looks_like_full_verify_endpoint(base, &api_type) {
        return base.to_string();
    }

    if verify_path.starts_with('/') {
        format!("{base}{verify_path}")
    } else {
        format!("{base}/{verify_path}")
    }
}

fn looks_like_full_verify_endpoint(api_url: &str, api_type: &ApiConnectionType) -> bool {
    let lower = api_url.to_ascii_lowercase();
    match api_type {
        ApiConnectionType::Search => {
            lower.ends_with("/search")
                || lower.ends_with("/images")
                || lower.ends_with("/news")
                || lower.ends_with("/maps")
                || lower.ends_with("/places")
                || lower.ends_with("/videos")
                || lower.ends_with("/shopping")
                || lower.ends_with("/scholar")
        }
        _ => lower.ends_with("/chat/completions"),
    }
}

fn api_type_label(api_type: &ApiConnectionType) -> &'static str {
    match api_type {
        ApiConnectionType::Llm => "LLM",
        ApiConnectionType::Search => "Search",
        ApiConnectionType::Stt => "STT",
        ApiConnectionType::Tts => "TTS",
        ApiConnectionType::Image => "Image",
        ApiConnectionType::Other => "Other",
    }
}

fn appears_masked_api_key(api_key: &str) -> bool {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.contains("***") || trimmed.ends_with("******")
}

fn default_registry_path() -> PathBuf {
    if let Ok(raw) = std::env::var(API_REGISTRY_ENV_PATH) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let root = default_app_data_root().unwrap_or_else(|| std::env::temp_dir().join("arxell"));
    root.join("api-connections.json")
}

fn read_registry_snapshot(path: &PathBuf) -> ApiRegistrySnapshot {
    let Ok(raw) = fs::read_to_string(path) else {
        return ApiRegistrySnapshot {
            version: API_REGISTRY_VERSION,
            connections: Vec::new(),
        };
    };
    let Ok(parsed) = serde_json::from_str::<ApiRegistrySnapshot>(&raw) else {
        return ApiRegistrySnapshot {
            version: API_REGISTRY_VERSION,
            connections: Vec::new(),
        };
    };
    parsed
}

fn parse_portable_import(payload_json: &str) -> Result<Vec<ApiConnectionPortableRecord>, String> {
    let trimmed = payload_json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(snapshot) = serde_json::from_str::<ApiConnectionsPortableSnapshot>(trimmed) {
        return Ok(snapshot.connections);
    }
    if let Ok(connections) = serde_json::from_str::<Vec<ApiConnectionPortableRecord>>(trimmed) {
        return Ok(connections);
    }
    if let Ok(snapshot) = serde_json::from_str::<ApiRegistrySnapshot>(trimmed) {
        let connections = snapshot
            .connections
            .into_iter()
            .map(|record| ApiConnectionPortableRecord {
                id: Some(record.id),
                api_type: record.api_type,
                api_url: record.api_url,
                name: record.name,
                api_key: record.api_key.unwrap_or_default(),
                model_name: record.model_name,
                cost_per_month_usd: record.cost_per_month_usd,
                api_standard_path: record.api_standard_path,
                created_ms: Some(record.created_ms),
            })
            .collect();
        return Ok(connections);
    }
    Err("failed parsing API connections import payload".to_string())
}

fn default_app_data_root() -> Option<PathBuf> {
    Some(app_paths::app_data_dir())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}
