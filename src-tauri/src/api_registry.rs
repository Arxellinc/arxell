use crate::contracts::{
    ApiConnectionAgentRecord, ApiConnectionRecord, ApiConnectionStatus, ApiConnectionType,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiConnectionSecretRecord {
    id: String,
    api_type: ApiConnectionType,
    api_url: String,
    name: Option<String>,
    api_key: String,
    model_name: Option<String>,
    cost_per_month_usd: Option<f64>,
    status: ApiConnectionStatus,
    status_message: String,
    last_checked_ms: Option<i64>,
    created_ms: i64,
    api_standard_path: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ApiRegistrySnapshot {
    version: u32,
    connections: Vec<ApiConnectionSecretRecord>,
}

pub struct ApiRegistryService {
    connections: RwLock<HashMap<String, ApiConnectionSecretRecord>>,
    registry_path: PathBuf,
}

impl ApiRegistryService {
    pub fn new() -> Self {
        let registry_path = default_registry_path();
        let snapshot = read_registry_snapshot(&registry_path);
        let mut connections = HashMap::new();
        for mut record in snapshot.connections {
            if appears_masked_api_key(record.api_key.as_str()) {
                record.status = ApiConnectionStatus::Warning;
                record.status_message =
                    "Stored API key appears masked. Re-enter the full API key and verify again."
                        .to_string();
                record.last_checked_ms = Some(now_ms());
            }
            connections.insert(record.id.clone(), record);
        }
        Self {
            connections: RwLock::new(connections),
            registry_path,
        }
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
        let api_key = normalize_required(input.api_key.as_str(), "apiKey")?;
        validate_api_key(api_key.as_str())?;
        let name = normalize_optional(input.name.as_deref());
        let model_name = normalize_optional(input.model_name.as_deref());
        let cost = normalize_cost(input.cost_per_month_usd)?;
        let api_standard_path = normalize_optional(input.api_standard_path.as_deref());
        let (status, status_message) =
            verify_connection(input.api_type.clone(), api_url.as_str(), api_key.as_str(), api_standard_path.as_deref()).await;

        let record = ApiConnectionSecretRecord {
            id: format!("api-{}", Uuid::new_v4()),
            api_type: input.api_type,
            api_url,
            name,
            api_key,
            model_name,
            cost_per_month_usd: cost,
            status,
            status_message,
            last_checked_ms: Some(now_ms()),
            created_ms: now_ms(),
            api_standard_path,
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

        let (status, status_message) = verify_connection(
            existing.api_type.clone(),
            existing.api_url.as_str(),
            existing.api_key.as_str(),
            existing.api_standard_path.as_deref(),
        )
        .await;
        existing.status = status;
        existing.status_message = status_message;
        existing.last_checked_ms = Some(now_ms());

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

    pub fn update(&self, id: &str, input: UpdateApiConnectionInput) -> Result<ApiConnectionRecord, String> {
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
            let normalized = normalize_required(api_key.as_str(), "apiKey")?;
            validate_api_key(normalized.as_str())?;
            existing.api_key = normalized;
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
        Ok(record.api_key.clone())
    }

    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let mut connections = self
            .connections
            .write()
            .expect("api registry lock poisoned");
        let deleted = connections.remove(id).is_some();
        self.persist_snapshot(&connections)?;
        Ok(deleted)
    }

    pub fn verified_for_agent(&self) -> Vec<ApiConnectionAgentRecord> {
        let connections = self.connections.read().expect("api registry lock poisoned");
        let mut records: Vec<_> = connections
            .values()
            .filter(|record| record.status == ApiConnectionStatus::Verified)
            .map(|record| ApiConnectionAgentRecord {
                id: record.id.clone(),
                api_type: record.api_type.clone(),
                api_url: record.api_url.clone(),
                name: record.name.clone(),
                api_key: record.api_key.clone(),
                model_name: record.model_name.clone(),
                cost_per_month_usd: record.cost_per_month_usd,
                api_standard_path: record.api_standard_path.clone(),
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
        candidates.into_iter().next().map(|record| ApiConnectionAgentRecord {
            id: record.id,
            api_type: record.api_type,
            api_url: record.api_url,
            name: record.name,
            api_key: record.api_key,
            model_name: record.model_name,
            cost_per_month_usd: record.cost_per_month_usd,
            api_standard_path: record.api_standard_path,
        })
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
}

impl Default for ApiRegistryService {
    fn default() -> Self {
        Self::new()
    }
}

fn to_public_record(record: &ApiConnectionSecretRecord) -> ApiConnectionRecord {
    let api_key_prefix = api_key_prefix(record.api_key.as_str());
    ApiConnectionRecord {
        id: record.id.clone(),
        api_type: record.api_type.clone(),
        api_url: record.api_url.clone(),
        name: record.name.clone(),
        api_key_masked: mask_api_key(record.api_key.as_str()),
        api_key_prefix,
        model_name: record.model_name.clone(),
        cost_per_month_usd: record.cost_per_month_usd,
        status: record.status.clone(),
        status_message: record.status_message.clone(),
        last_checked_ms: record.last_checked_ms,
        created_ms: record.created_ms,
        api_standard_path: record.api_standard_path.clone(),
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

fn validate_api_key(api_key: &str) -> Result<(), String> {
    if appears_masked_api_key(api_key) {
        return Err(
            "apiKey appears to be masked (contains ***). Paste the full raw key, not the table preview."
                .to_string(),
        );
    }
    Ok(())
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
    api_key: &str,
    api_standard_path: Option<&str>,
) -> (ApiConnectionStatus, String) {
    if appears_masked_api_key(api_key) {
        return (
            ApiConnectionStatus::Warning,
            "Verification skipped: API key appears masked. Paste the full raw key and verify again."
                .to_string(),
        );
    }

    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(12))
        .build()
    {
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
        ApiConnectionType::Search => client
            .post(&verify_url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-api-key", api_key)
            .header("User-Agent", "arxell-lite/1.0")
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({"q":"test","num":1})),
        _ => client
            .post(&verify_url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-api-key", api_key)
            .header("User-Agent", "arxell-lite/1.0")
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({"model":"glm-4","messages":[{"role":"system","content":"You are a helpful AI assistant."},{"role":"user","content":"Hello, please introduce yourself."}],"stream":false})),
    };

    match request.send().await {
        Ok(response) => {
            if response.status().is_success() {
                (
                    ApiConnectionStatus::Verified,
                    format!(
                        "Verified {} endpoint at {} (HTTP {})",
                        api_type_label(&api_type),
                        verify_url,
                        response.status().as_u16()
                    ),
                )
            } else {
                (
                    ApiConnectionStatus::Warning,
                    format!(
                        "Connection reachable at {} but verification failed (HTTP {})",
                        verify_url,
                        response.status().as_u16()
                    ),
                )
            }
        }
        Err(error) => (
            ApiConnectionStatus::Warning,
            format!("Connection test failed: {error}"),
        ),
    }
}

fn build_verify_url(api_type: ApiConnectionType, api_url: &str, api_standard_path: Option<&str>) -> String {
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
    std::env::temp_dir()
        .join("arxell-lite")
        .join("api-connections.json")
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

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}
