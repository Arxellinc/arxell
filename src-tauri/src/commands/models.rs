use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

use super::logs;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    pub api_type: String,
    pub model_id: String,
    pub base_url: String,
    pub api_key: String,
    pub parameter_count: Option<i64>,
    pub speed_tps: Option<f64>,
    pub context_length: Option<i64>,
    pub monthly_cost: Option<f64>,
    pub cost_per_million_tokens: Option<f64>,
    pub last_available: bool,
    pub last_check_message: String,
    pub last_check_at: Option<i64>,
    pub is_primary: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelVerifyResult {
    pub ok: bool,
    pub reachable: bool,
    pub model_found: bool,
    pub response_ok: bool,
    pub status_code: Option<u16>,
    pub latency_ms: u128,
    pub message: String,
}

fn normalize_base_url(base_url: &str) -> String {
    let mut root = base_url.trim().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/completions", "/responses", "/models"] {
        if let Some(stripped) = root.strip_suffix(suffix) {
            root = stripped.trim_end_matches('/').to_string();
            break;
        }
    }

    if let Some(stripped) = root.strip_suffix("/v1") {
        let prior_is_version = stripped
            .rsplit('/')
            .next()
            .map(|seg| {
                seg.len() > 1
                    && seg.as_bytes()[0].eq_ignore_ascii_case(&b'v')
                    && seg[1..].chars().all(|c| c.is_ascii_digit())
            })
            .unwrap_or(false);
        if prior_is_version {
            root = stripped.to_string();
        }
    }

    let has_version_suffix = root
        .rsplit('/')
        .next()
        .map(|seg| {
            seg.len() > 1
                && seg.as_bytes()[0].eq_ignore_ascii_case(&b'v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false);

    if has_version_suffix {
        root
    } else {
        format!("{root}/v1")
    }
}

fn normalize_models_url(base_url: &str) -> String {
    format!(
        "{}/models",
        normalize_base_url(base_url).trim_end_matches('/')
    )
}

fn normalize_chat_url(base_url: &str) -> String {
    format!(
        "{}/chat/completions",
        normalize_base_url(base_url).trim_end_matches('/')
    )
}

fn sync_primary_model_settings(
    db: &rusqlite::Connection,
    model_id: &str,
    base_url: &str,
    api_key: &str,
) -> Result<(), String> {
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["model", model_id],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["base_url", base_url],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["api_key", api_key],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["primary_llm_source", "api"],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn derive_cost_per_million(monthly_cost: Option<f64>, speed_tps: Option<f64>) -> Option<f64> {
    let (monthly, speed) = (monthly_cost?, speed_tps?);
    if monthly <= 0.0 || speed <= 0.0 {
        return None;
    }

    // Approximation: sustained throughput across a 30-day month.
    let tokens_per_month = speed * 2_592_000.0;
    if tokens_per_month <= 0.0 {
        return None;
    }

    Some((monthly / tokens_per_month) * 1_000_000.0)
}

fn model_exists_in_response(json: &Value, wanted_model_id: &str) -> bool {
    let wanted = wanted_model_id.trim().to_ascii_lowercase();
    if wanted.is_empty() {
        return true;
    }

    if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
        if data.iter().any(|m| {
            m.get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case(&wanted))
                .unwrap_or(false)
                || m.get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(&wanted))
                    .unwrap_or(false)
        }) {
            return true;
        }
    }

    if let Some(models) = json.get("models").and_then(|v| v.as_array()) {
        if models.iter().any(|m| {
            m.get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case(&wanted))
                .unwrap_or(false)
                || m.get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(&wanted))
                    .unwrap_or(false)
        }) {
            return true;
        }
    }

    if let Some(list) = json.as_array() {
        if list.iter().any(|m| {
            m.as_str()
                .map(|s| s.eq_ignore_ascii_case(&wanted))
                .unwrap_or(false)
        }) {
            return true;
        }
    }

    false
}

fn find_matched_model<'a>(json: &'a Value, wanted_model_id: &str) -> Option<&'a Value> {
    let wanted = wanted_model_id.trim().to_ascii_lowercase();

    let data = json.get("data").and_then(|v| v.as_array()).and_then(|arr| {
        arr.iter().find(|m| {
            m.get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case(&wanted))
                .unwrap_or(false)
                || m.get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(&wanted))
                    .unwrap_or(false)
        })
    });
    if data.is_some() {
        return data;
    }

    json.get("models")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find(|m| {
                m.get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(&wanted))
                    .unwrap_or(false)
                    || m.get("name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.eq_ignore_ascii_case(&wanted))
                        .unwrap_or(false)
            })
        })
}

fn extract_f64(obj: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(v) = obj.get(key) {
            if let Some(n) = v.as_f64() {
                return Some(n);
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.parse::<f64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn extract_i64(obj: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(v) = obj.get(key) {
            if let Some(n) = v.as_i64() {
                return Some(n);
            }
            if let Some(n) = v.as_u64() {
                if n <= i64::MAX as u64 {
                    return Some(n as i64);
                }
            }
            if let Some(f) = v.as_f64() {
                return Some(f as i64);
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.parse::<i64>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn extract_specs_from_model_json(
    model_obj: Option<&Value>,
) -> (
    Option<i64>,
    Option<f64>,
    Option<i64>,
    Option<f64>,
    Option<f64>,
) {
    let Some(obj) = model_obj else {
        return (None, None, None, None, None);
    };

    let parameter_count = extract_i64(obj, &["parameter_count", "parameters", "params"]);
    let speed_tps = extract_f64(obj, &["speed_tps", "tokens_per_second", "throughput_tps"]);
    let context_length = extract_i64(
        obj,
        &[
            "context_length",
            "max_context_length",
            "context_window",
            "input_token_limit",
        ],
    );

    let monthly_cost = extract_f64(
        obj,
        &["monthly_cost", "monthly_price", "subscription_monthly"],
    )
    .or_else(|| {
        obj.get("pricing")
            .and_then(|p| extract_f64(p, &["monthly", "monthly_cost", "subscription_monthly"]))
    });

    let cost_per_million = extract_f64(
        obj,
        &[
            "cost_per_million_tokens",
            "cost_per_million",
            "input_cost_per_million",
        ],
    )
    .or_else(|| {
        obj.get("pricing").and_then(|p| {
            extract_f64(
                p,
                &[
                    "per_million_tokens",
                    "input_per_million",
                    "cost_per_million",
                ],
            )
        })
    });

    (
        parameter_count,
        speed_tps,
        context_length,
        monthly_cost,
        cost_per_million,
    )
}

#[tauri::command]
pub fn cmd_model_list_all(state: State<'_, AppState>) -> Result<Vec<ModelConfig>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, name, api_type, model_id, base_url, api_key, parameter_count, speed_tps, context_length, monthly_cost, cost_per_million_tokens, last_available, last_check_message, last_check_at, is_primary, created_at\n             FROM model_configs\n             ORDER BY is_primary DESC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let configs = stmt
        .query_map([], |row| {
            Ok(ModelConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                api_type: row.get(2)?,
                model_id: row.get(3)?,
                base_url: row.get(4)?,
                api_key: row.get(5)?,
                parameter_count: row.get(6)?,
                speed_tps: row.get(7)?,
                context_length: row.get(8)?,
                monthly_cost: row.get(9)?,
                cost_per_million_tokens: row.get(10)?,
                last_available: row.get::<_, i64>(11)? != 0,
                last_check_message: row.get(12)?,
                last_check_at: row.get(13)?,
                is_primary: row.get::<_, i64>(14)? != 0,
                created_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(configs)
}

#[tauri::command]
pub fn cmd_model_add(
    state: State<'_, AppState>,
    name: String,
    model_id: String,
    base_url: String,
    api_key: Option<String>,
    api_type: Option<String>,
    parameter_count: Option<i64>,
    speed_tps: Option<f64>,
    context_length: Option<i64>,
    monthly_cost: Option<f64>,
    cost_per_million_tokens: Option<f64>,
    is_primary: Option<bool>,
) -> Result<ModelConfig, String> {
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp_millis();
    let is_primary = is_primary.unwrap_or(false);
    let api_key = api_key.unwrap_or_default();
    let api_type = api_type.unwrap_or_else(|| "chat".to_string());
    let computed_cost =
        cost_per_million_tokens.or_else(|| derive_cost_per_million(monthly_cost, speed_tps));
    let normalized_base_url = normalize_base_url(&base_url);

    let db = state.db.lock().unwrap();

    if is_primary {
        db.execute("UPDATE model_configs SET is_primary = 0", [])
            .map_err(|e| e.to_string())?;
    }

    db.execute(
        "INSERT INTO model_configs (id, name, api_type, model_id, base_url, api_key, parameter_count, speed_tps, context_length, monthly_cost, cost_per_million_tokens, last_available, last_check_message, last_check_at, is_primary, created_at)\n         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, '', NULL, ?12, ?13)",
        rusqlite::params![
            id,
            name,
            api_type,
            model_id,
            normalized_base_url,
            api_key,
            parameter_count,
            speed_tps,
            context_length,
            monthly_cost,
            computed_cost,
            is_primary as i64,
            created_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    if is_primary {
        sync_primary_model_settings(&db, &model_id, &normalized_base_url, &api_key)?;
    }

    Ok(ModelConfig {
        id,
        name,
        api_type,
        model_id,
        base_url: normalized_base_url,
        api_key,
        parameter_count,
        speed_tps,
        context_length,
        monthly_cost,
        cost_per_million_tokens: computed_cost,
        last_available: false,
        last_check_message: String::new(),
        last_check_at: None,
        is_primary,
        created_at,
    })
}

#[tauri::command]
pub fn cmd_model_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    model_id: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    api_type: Option<String>,
    parameter_count: Option<i64>,
    speed_tps: Option<f64>,
    context_length: Option<i64>,
    monthly_cost: Option<f64>,
    cost_per_million_tokens: Option<f64>,
    is_primary: Option<bool>,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    if is_primary == Some(true) {
        db.execute("UPDATE model_configs SET is_primary = 0", [])
            .map_err(|e| e.to_string())?;
    }

    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(v) = name {
        updates.push("name = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = model_id {
        updates.push("model_id = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = base_url {
        updates.push("base_url = ?");
        params.push(Box::new(normalize_base_url(&v)));
    }
    if let Some(v) = api_key {
        updates.push("api_key = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = api_type {
        updates.push("api_type = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = parameter_count {
        updates.push("parameter_count = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = speed_tps {
        updates.push("speed_tps = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = context_length {
        updates.push("context_length = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = monthly_cost {
        updates.push("monthly_cost = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = cost_per_million_tokens {
        updates.push("cost_per_million_tokens = ?");
        params.push(Box::new(v));
    }
    if let Some(v) = is_primary {
        updates.push("is_primary = ?");
        params.push(Box::new(v as i64));
    }

    if updates.is_empty() {
        return Ok(());
    }

    params.push(Box::new(id.clone()));

    let sql = format!(
        "UPDATE model_configs SET {} WHERE id = ?",
        updates.join(", ")
    );

    db.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;

    // If explicit CPM was not provided and monthly/speed changed, recompute.
    if cost_per_million_tokens.is_none() && (monthly_cost.is_some() || speed_tps.is_some()) {
        db.execute(
            "UPDATE model_configs\n             SET cost_per_million_tokens = (monthly_cost / NULLIF(speed_tps * 2592000.0, 0)) * 1000000.0\n             WHERE id = ?1 AND monthly_cost IS NOT NULL AND speed_tps IS NOT NULL",
            [&id],
        )
        .map_err(|e| e.to_string())?;
    }

    if is_primary == Some(true) {
        let (resolved_model_id, resolved_base_url, resolved_api_key): (String, String, String) = db
            .query_row(
                "SELECT model_id, base_url, api_key FROM model_configs WHERE id = ?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        sync_primary_model_settings(
            &db,
            &resolved_model_id,
            &resolved_base_url,
            &resolved_api_key,
        )?;
    }

    Ok(())
}

#[tauri::command]
pub fn cmd_model_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM model_configs WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_model_set_primary(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    db.execute("UPDATE model_configs SET is_primary = 0", [])
        .map_err(|e| e.to_string())?;

    db.execute(
        "UPDATE model_configs SET is_primary = 1 WHERE id = ?1",
        [&id],
    )
    .map_err(|e| e.to_string())?;

    let (model_id, base_url, api_key): (String, String, String) = db
        .query_row(
            "SELECT model_id, base_url, api_key FROM model_configs WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    sync_primary_model_settings(&db, &model_id, &base_url, &api_key)?;

    Ok(())
}

#[tauri::command]
pub async fn cmd_model_verify(
    state: State<'_, AppState>,
    id: String,
    test_response: Option<bool>,
) -> Result<ModelVerifyResult, String> {
    let cfg = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT name, model_id, base_url, api_key, monthly_cost, speed_tps, cost_per_million_tokens, parameter_count, context_length FROM model_configs WHERE id = ?1",
            [&id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };

    let (
        name,
        model_id,
        base_url,
        api_key,
        existing_monthly,
        existing_speed,
        existing_cpm,
        existing_params,
        existing_ctx,
    ) = cfg;

    let normalized_base = normalize_base_url(&base_url);
    let models_url = normalize_models_url(&normalized_base);
    let chat_url = normalize_chat_url(&normalized_base);
    let start_msg = format!("API verify started: name='{name}', model='{model_id}', url='{models_url}', test_response={}", test_response.unwrap_or(false));
    log::info!("{}", start_msg);
    logs::info(&start_msg);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&models_url);
    if !api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let started = Instant::now();
    let mut models_status_code: Option<u16> = None;
    let mut model_found = false;
    let mut api_params: Option<i64> = None;
    let mut api_speed: Option<f64> = None;
    let mut api_ctx: Option<i64> = None;
    let mut api_monthly: Option<f64> = None;
    let mut api_cpm: Option<f64> = None;

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            models_status_code = Some(status.as_u16());
            if status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                let parsed_json = serde_json::from_str::<Value>(&body).ok();
                model_found = parsed_json
                    .as_ref()
                    .map(|json| model_exists_in_response(json, &model_id))
                    .unwrap_or(false);
                let model_obj = parsed_json
                    .as_ref()
                    .and_then(|json| find_matched_model(json, &model_id));
                let extracted = extract_specs_from_model_json(model_obj);
                api_params = extracted.0;
                api_speed = extracted.1;
                api_ctx = extracted.2;
                api_monthly = extracted.3;
                api_cpm = extracted.4;
            }
        }
        Err(e) => {
            let msg = format!(
                "API verify models probe failed: name='{}', model='{}', err={}",
                name, model_id, e
            );
            log::warn!("{}", msg);
            logs::warn(&msg);
        }
    }

    let latency_ms = started.elapsed().as_millis();
    let mut response_ok = false;
    if test_response.unwrap_or(false) {
        let payload = serde_json::json!({
            "model": model_id,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 8,
            "temperature": 0.0
        });

        let mut chat_req = client.post(&chat_url).json(&payload);
        if !api_key.trim().is_empty() {
            chat_req = chat_req.header("Authorization", format!("Bearer {}", api_key));
        }

        match chat_req.send().await {
            Ok(chat_resp) if chat_resp.status().is_success() => {
                let chat_body = chat_resp.text().await.unwrap_or_default();
                if let Ok(chat_json) = serde_json::from_str::<Value>(&chat_body) {
                    let first_choice = chat_json
                        .get("choices")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first());
                    let has_choice = first_choice.is_some();
                    let text = first_choice
                        .and_then(|c| {
                            c.get("message")
                                .and_then(|m| m.get("content"))
                                .and_then(|v| v.as_str())
                                .or_else(|| {
                                    c.get("message")
                                        .and_then(|m| m.get("reasoning_content"))
                                        .and_then(|v| v.as_str())
                                })
                                .or_else(|| c.get("text").and_then(|v| v.as_str()))
                        })
                        .unwrap_or("")
                        .trim()
                        .to_string();

                    response_ok = has_choice || !text.is_empty();
                } else {
                    // Some providers return non-OpenAI JSON/text while still succeeding.
                    response_ok = true;
                }
            }
            _ => {
                response_ok = false;
            }
        }
    }

    let ok = if test_response.unwrap_or(false) {
        response_ok
    } else {
        model_found
    };

    let merged_monthly = api_monthly.or(existing_monthly);
    let merged_speed = api_speed.or(existing_speed);
    let merged_cpm = api_cpm
        .or(existing_cpm)
        .or_else(|| derive_cost_per_million(merged_monthly, merged_speed));
    let merged_params = api_params.or(existing_params);
    let merged_ctx = api_ctx.or(existing_ctx);

    let message = if ok {
        if test_response.unwrap_or(false) {
            format!("Available {}ms", latency_ms)
        } else {
            format!("Model listed {}ms", latency_ms)
        }
    } else if test_response.unwrap_or(false) {
        match models_status_code {
            Some(code) if code >= 400 => {
                format!("No response (models HTTP {}) {}ms", code, latency_ms)
            }
            _ => format!("No response {}ms", latency_ms),
        }
    } else {
        match models_status_code {
            Some(code) if code >= 400 => format!("Models HTTP {} {}ms", code, latency_ms),
            _ => format!("Model missing {}ms", latency_ms),
        }
    };

    let result = ModelVerifyResult {
        ok,
        reachable: true,
        model_found,
        response_ok,
        status_code: models_status_code,
        latency_ms,
        message: message.clone(),
    };

    let now = chrono::Utc::now().timestamp_millis();
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE model_configs SET\n               parameter_count = COALESCE(?2, parameter_count),\n               speed_tps = COALESCE(?3, speed_tps),\n               context_length = COALESCE(?4, context_length),\n               monthly_cost = COALESCE(?5, monthly_cost),\n               cost_per_million_tokens = COALESCE(?6, cost_per_million_tokens),\n               last_available = ?7,\n               last_check_message = ?8,\n               last_check_at = ?9,\n               base_url = ?10\n             WHERE id = ?1",
            rusqlite::params![
                id,
                merged_params,
                merged_speed,
                merged_ctx,
                merged_monthly,
                merged_cpm,
                if ok { 1i64 } else { 0i64 },
                message,
                now,
                normalized_base,
            ],
        );
    }

    let msg = format!(
        "API verify complete: name='{}', model='{}', ok={}, listed={}, responded={}, latency={}ms",
        name, model_id, result.ok, result.model_found, result.response_ok, latency_ms
    );
    if result.ok {
        log::info!("{}", msg);
        logs::info(&msg);
    } else {
        log::warn!("{}", msg);
        logs::warn(&msg);
    }

    Ok(result)
}
