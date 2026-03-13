use std::collections::HashMap;
use tauri::State;

use super::logs;
use crate::AppState;

fn has_version_suffix(base: &str) -> bool {
    base.rsplit('/')
        .next()
        .map(|seg| {
            seg.len() > 1
                && seg.as_bytes()[0].eq_ignore_ascii_case(&b'v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false)
}

#[tauri::command]
pub async fn cmd_models_list(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let (base_url, api_key) = {
        let db = state.db.lock().unwrap();
        let base_url = db
            .query_row(
                "SELECT value FROM settings WHERE key = 'base_url'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "http://127.0.0.1:1234/v1".to_string());
        let api_key = db
            .query_row(
                "SELECT value FROM settings WHERE key = 'api_key'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "lm-studio".to_string());
        (base_url, api_key)
    };

    // Ensure base_url ends with a version suffix for OpenAI-compatible endpoints.
    let base_url = if has_version_suffix(base_url.trim_end_matches('/')) {
        base_url
    } else {
        format!("{}/v1", base_url.trim_end_matches('/'))
    };

    let url = format!("{}/models", base_url.trim_end_matches('/'));
    log::info!("Fetching models from: {}", url);
    logs::info(&format!("Fetching models from: {}", url));

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("Request failed: {}", e);
            logs::error(&msg);
            msg
        })?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| {
        let msg = format!("Failed to read response: {}", e);
        logs::error(&msg);
        msg
    })?;
    log::info!("Models endpoint returned status {}: {}", status, body);
    logs::info(&format!(
        "Models endpoint returned status {}: {}",
        status, body
    ));

    let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        let msg = format!("Invalid JSON response: {} - Body: {}", e, body);
        logs::error(&msg);
        msg
    })?;

    // Try OpenAI format first: { "data": [{ "id": "model-name" }] }
    if let Some(data) = json["data"].as_array() {
        let models: Vec<String> = data
            .iter()
            .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
            .collect();
        if !models.is_empty() {
            let msg = format!("Found {} models in OpenAI format", models.len());
            log::info!("{}", msg);
            logs::info(&msg);
            return Ok(models);
        }
    }

    // Try Ollama format: { "models": [{ "name": "model-name" }] }
    if let Some(models_arr) = json["models"].as_array() {
        let models: Vec<String> = models_arr
            .iter()
            .filter_map(|m| {
                m["name"]
                    .as_str()
                    .or_else(|| m["id"].as_str())
                    .map(|s| s.to_string())
            })
            .collect();
        if !models.is_empty() {
            let msg = format!("Found {} models in Ollama format", models.len());
            log::info!("{}", msg);
            logs::info(&msg);
            return Ok(models);
        }
    }

    // Try simple array format: ["model1", "model2"]
    if let Some(arr) = json.as_array() {
        let models: Vec<String> = arr
            .iter()
            .filter_map(|m| m.as_str().map(|s| s.to_string()))
            .collect();
        if !models.is_empty() {
            let msg = format!("Found {} models in array format", models.len());
            log::info!("{}", msg);
            logs::info(&msg);
            return Ok(models);
        }
    }

    let msg = format!("Could not parse models from response: {}", body);
    log::warn!("{}", msg);
    logs::warn(&msg);
    Err(format!("Could not parse models from response. Expected OpenAI format ({{data: [{{id: ...}}]}}) or Ollama format ({{models: [{{name: ...}}]}})"))
}

#[tauri::command]
pub fn cmd_settings_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let db = state.db.lock().unwrap();
    let result = db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cmd_settings_set(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_settings_get_all(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let map = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(map)
}
