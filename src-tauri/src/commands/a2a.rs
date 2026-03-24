use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::a2a::{runtime::A2ARuntime, store, types::ProcessStatus};
use crate::AppState;

fn parse_process_status(raw: &str) -> Result<ProcessStatus, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "queued" => Ok(ProcessStatus::Queued),
        "running" => Ok(ProcessStatus::Running),
        "blocked" => Ok(ProcessStatus::Blocked),
        "failed" => Ok(ProcessStatus::Failed),
        "succeeded" => Ok(ProcessStatus::Succeeded),
        "canceled" | "cancelled" => Ok(ProcessStatus::Canceled),
        _ => Err(format!(
            "Invalid process status '{}'. Expected queued|running|blocked|failed|succeeded|canceled",
            raw
        )),
    }
}

#[derive(Debug, Clone, Serialize)]
struct A2AChangedEvent<'a> {
    kind: &'a str,
    process_id: Option<&'a str>,
    card_id: Option<&'a str>,
}

fn emit_changed(app: &AppHandle, kind: &str, process_id: Option<&str>, card_id: Option<&str>) {
    let payload = A2AChangedEvent {
        kind,
        process_id,
        card_id,
    };
    let _ = app.emit("a2a:changed", payload);
}

#[tauri::command]
pub fn cmd_a2a_process_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<store::A2AProcessSummary>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    store::list_processes(&db, limit.unwrap_or(50), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_process_get(
    state: State<'_, AppState>,
    process_id: String,
) -> Result<Option<store::A2AProcessDetail>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    store::get_process_detail(&db, process_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_process_events(
    state: State<'_, AppState>,
    process_id: String,
    limit: Option<i64>,
) -> Result<Vec<store::A2AStoredEvent>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    store::list_process_events(&db, process_id.trim(), limit.unwrap_or(200))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_a2a_seed_demo_process(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let runtime = A2ARuntime::new(&db);
    let process_id = runtime.seed_demo_process().map_err(|e| e.to_string())?;
    emit_changed(&app, "process_seeded", Some(process_id.as_str()), None);
    Ok(process_id)
}

#[tauri::command]
pub fn cmd_a2a_process_create(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    initiator: Option<String>,
    actor: Option<String>,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let runtime = A2ARuntime::new(&db);
    let process_id = runtime
        .create_process(
            title.trim(),
            initiator.as_deref().unwrap_or("primary-agent"),
            actor.as_deref().unwrap_or("primary-agent"),
        )
        .map_err(|e| e.to_string())?;
    emit_changed(&app, "process_created", Some(process_id.as_str()), None);
    Ok(process_id)
}

#[tauri::command]
pub fn cmd_a2a_process_set_status(
    app: AppHandle,
    state: State<'_, AppState>,
    process_id: String,
    status: String,
    reason: Option<String>,
    actor: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let runtime = A2ARuntime::new(&db);
    let parsed = parse_process_status(status.as_str())?;
    runtime
        .set_process_status(
            process_id.trim(),
            parsed,
            reason,
            actor.as_deref().unwrap_or("primary-agent"),
        )
        .map_err(|e| e.to_string())?;
    emit_changed(
        &app,
        "process_status_changed",
        Some(process_id.trim()),
        None,
    );
    Ok(())
}

#[tauri::command]
pub fn cmd_a2a_process_retry(
    app: AppHandle,
    state: State<'_, AppState>,
    process_id: String,
    actor: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let runtime = A2ARuntime::new(&db);
    runtime
        .retry_process(
            process_id.trim(),
            actor.as_deref().unwrap_or("primary-agent"),
        )
        .map_err(|e| e.to_string())?;
    emit_changed(&app, "process_retried", Some(process_id.trim()), None);
    Ok(())
}

#[tauri::command]
pub fn cmd_a2a_agent_cards_list(
    state: State<'_, AppState>,
) -> Result<Vec<store::A2AAgentCardRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    store::list_agent_cards(&db).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn cmd_a2a_agent_card_create(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    role: String,
    description: String,
    protocol_version: Option<String>,
    version: Option<String>,
    url: Option<String>,
    preferred_model_id: Option<String>,
    fallback_model_ids_json: Option<String>,
    skills_json: Option<String>,
    capabilities_json: Option<String>,
    default_input_modes_json: Option<String>,
    default_output_modes_json: Option<String>,
    additional_interfaces_json: Option<String>,
    logic_language: Option<String>,
    logic_source: Option<String>,
    color: Option<String>,
    enabled: Option<bool>,
    sort_order: Option<i64>,
) -> Result<store::A2AAgentCardRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let card = store::create_agent_card(
        &db,
        name,
        role,
        description,
        protocol_version,
        version,
        url,
        preferred_model_id,
        fallback_model_ids_json,
        skills_json,
        capabilities_json,
        default_input_modes_json,
        default_output_modes_json,
        additional_interfaces_json,
        logic_language,
        logic_source,
        color,
        enabled,
        sort_order,
    )
    .map_err(|e| e.to_string())?;
    emit_changed(&app, "card_created", None, Some(card.card_id.as_str()));
    Ok(card)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn cmd_a2a_agent_card_update(
    app: AppHandle,
    state: State<'_, AppState>,
    card_id: String,
    name: Option<String>,
    role: Option<String>,
    description: Option<String>,
    protocol_version: Option<String>,
    version: Option<String>,
    url: Option<String>,
    preferred_model_id: Option<String>,
    fallback_model_ids_json: Option<String>,
    skills_json: Option<String>,
    capabilities_json: Option<String>,
    default_input_modes_json: Option<String>,
    default_output_modes_json: Option<String>,
    additional_interfaces_json: Option<String>,
    logic_language: Option<String>,
    logic_source: Option<String>,
    color: Option<String>,
    enabled: Option<bool>,
    sort_order: Option<i64>,
) -> Result<store::A2AAgentCardRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let updated = store::update_agent_card(
        &db,
        card_id.trim(),
        name,
        role,
        description,
        protocol_version,
        version,
        url,
        preferred_model_id,
        fallback_model_ids_json,
        skills_json,
        capabilities_json,
        default_input_modes_json,
        default_output_modes_json,
        additional_interfaces_json,
        logic_language,
        logic_source,
        color,
        enabled,
        sort_order,
    )
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Agent card not found: {}", card_id))?;
    emit_changed(&app, "card_updated", None, Some(updated.card_id.as_str()));
    Ok(updated)
}

#[tauri::command]
pub fn cmd_a2a_agent_card_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    card_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let deleted = store::delete_agent_card(&db, card_id.trim()).map_err(|e| e.to_string())?;
    if deleted {
        emit_changed(&app, "card_deleted", None, Some(card_id.trim()));
        Ok(())
    } else {
        Err(format!("Agent card not found: {}", card_id))
    }
}
