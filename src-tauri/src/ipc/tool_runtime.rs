#![cfg(feature = "tauri-runtime")]

use crate::contracts::{
    EventSeverity, EventStage, Subsystem, ToolInvokeRequest, ToolInvokeResponse, ToolMode,
};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::{build_registry, registry::InvokeRegistry};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn tool_invoke_ok(request: &ToolInvokeRequest, data: Value) -> ToolInvokeResponse {
    ToolInvokeResponse {
        correlation_id: request.correlation_id.clone(),
        tool_id: request.tool_id.clone(),
        action: request.action.clone(),
        ok: true,
        data,
        error: None,
    }
}

fn tool_invoke_err(request: &ToolInvokeRequest, error: String) -> ToolInvokeResponse {
    ToolInvokeResponse {
        correlation_id: request.correlation_id.clone(),
        tool_id: request.tool_id.clone(),
        action: request.action.clone(),
        ok: false,
        data: json!({}),
        error: Some(error),
    }
}

pub async fn invoke_tool(
    state: &TauriBridgeState,
    request: ToolInvokeRequest,
) -> Result<ToolInvokeResponse, String> {
    static REGISTRY: OnceLock<InvokeRegistry> = OnceLock::new();
    let registry = REGISTRY.get_or_init(build_registry);

    // Enforce ToolMode for flow tool side-effect actions
    if request.tool_id == "flow" {
        match request.action.as_str() {
            "start" => {
                // dryRun=false or autoPush=true require non-sandbox mode
                if let Some(dry_run) = request.payload.get("dryRun").and_then(|v| v.as_bool()) {
                    if !dry_run && matches!(request.mode, ToolMode::Sandbox) {
                        return Ok(tool_invoke_err(
                            &request,
                            "flow.start with dryRun=false requires mode other than sandbox".to_string(),
                        ));
                    }
                }
                if let Some(auto_push) = request.payload.get("autoPush").and_then(|v| v.as_bool()) {
                    if auto_push && matches!(request.mode, ToolMode::Sandbox) {
                        return Ok(tool_invoke_err(
                            &request,
                            "flow.start with autoPush=true requires mode other than sandbox".to_string(),
                        ));
                    }
                }
            }
            "rerun-validation" => {
                // Validation rerun executes commands, requires non-sandbox
                if matches!(request.mode, ToolMode::Sandbox) {
                    return Ok(tool_invoke_err(
                        &request,
                        "flow.rerun-validation requires mode other than sandbox".to_string(),
                    ));
                }
            }
            _ => {}
        }
    }

    let response = match registry.get(request.tool_id.as_str(), request.action.as_str()) {
        Some(handler) => match handler(state, request.payload.clone()).await {
            Ok(result) => tool_invoke_ok(&request, result),
            Err(err) => tool_invoke_err(&request, err),
        },
        None => tool_invoke_err(
            &request,
            format!(
                "unsupported tool invoke target: {}.{}",
                request.tool_id, request.action
            ),
        ),
    };

    Ok(response)
}

pub async fn invoke_legacy_tool_command<TReq, TRes>(
    state: &TauriBridgeState,
    correlation_id: &str,
    legacy_command: &str,
    tool_id: &str,
    action: &str,
    request: &TReq,
) -> Result<TRes, String>
where
    TReq: Serialize,
    TRes: DeserializeOwned,
{
    static LEGACY_WRAPPER_COUNTS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    let counts = LEGACY_WRAPPER_COUNTS.get_or_init(|| Mutex::new(HashMap::new()));
    let next_count = {
        let mut guard = counts
            .lock()
            .map_err(|_| "legacy wrapper counter lock poisoned".to_string())?;
        let entry = guard.entry(legacy_command.to_string()).or_insert(0);
        *entry += 1;
        *entry
    };

    state.hub.emit(state.hub.make_event(
        correlation_id,
        Subsystem::Ipc,
        "cmd.legacy_wrapper.used",
        EventStage::Progress,
        EventSeverity::Info,
        json!({
            "legacyCommand": legacy_command,
            "toolId": tool_id,
            "action": action,
            "count": next_count
        }),
    ));

    let payload = serde_json::to_value(request)
        .map_err(|e| format!("failed serializing tool payload: {e}"))?;
    let response = invoke_tool(
        state,
        ToolInvokeRequest {
            correlation_id: correlation_id.to_string(),
            tool_id: tool_id.to_string(),
            action: action.to_string(),
            mode: ToolMode::Sandbox,
            payload,
        },
    )
    .await?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| format!("tool invoke failed for {}.{}", tool_id, action)));
    }
    serde_json::from_value(response.data)
        .map_err(|e| format!("failed deserializing tool response: {e}"))
}
