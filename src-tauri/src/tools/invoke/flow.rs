#![cfg(feature = "tauri-runtime")]

use crate::contracts::{
    FlowListRunsRequest, FlowNudgeRequest, FlowPauseRequest, FlowRerunValidationRequest,
    FlowStartRequest, FlowStatusRequest, FlowStopRequest,
};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::registry::{decode_payload, InvokeRegistry, ToolInvokeFuture};
use serde_json::Value;

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("flow", &["start"], invoke_start);
    registry.register("flow", &["stop"], invoke_stop);
    registry.register("flow", &["status"], invoke_status);
    registry.register("flow", &["pause", "set-paused", "setPaused"], invoke_pause);
    registry.register(
        "flow",
        &["nudge", "redirect", "redirect-task"],
        invoke_nudge,
    );
    registry.register("flow", &["list-runs", "listRuns"], invoke_list_runs);
    registry.register(
        "flow",
        &["rerun-validation", "rerunValidation"],
        invoke_rerun_validation,
    );
}

fn invoke_start(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowStartRequest = decode_payload(payload)?;
        let result = flow_handler.start(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow start response: {e}"))
    })
}

fn invoke_stop(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowStopRequest = decode_payload(payload)?;
        let result = flow_handler.stop(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow stop response: {e}"))
    })
}

fn invoke_status(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowStatusRequest = decode_payload(payload)?;
        let result = flow_handler.status(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow status response: {e}"))
    })
}

fn invoke_pause(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowPauseRequest = decode_payload(payload)?;
        let result = flow_handler.pause(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow pause response: {e}"))
    })
}

fn invoke_nudge(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowNudgeRequest = decode_payload(payload)?;
        let result = flow_handler.nudge(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow nudge response: {e}"))
    })
}

fn invoke_list_runs(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowListRunsRequest = decode_payload(payload)?;
        let result = flow_handler.list_runs(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow list-runs response: {e}"))
    })
}

fn invoke_rerun_validation(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let flow_handler = state.flow_handler.clone();
    Box::pin(async move {
        let req: FlowRerunValidationRequest = decode_payload(payload)?;
        let result = flow_handler.rerun_validation(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing flow rerun-validation response: {e}"))
    })
}
