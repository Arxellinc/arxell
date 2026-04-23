#![cfg(feature = "tauri-runtime")]

//! Looper invoke handler
//!
//! This module handles all IPC invoke calls for the Looper tool.
//! Looper is a multi-agent orchestration tool with 4 phases:
//!   Planner → Executor → Validator → Critic
//!
//! The backend owns terminal session management and phase state machine
//! transitions. The frontend observes state via events emitted by this handler.

use crate::contracts::{
    LooperAdvanceRequest, LooperCheckOpenCodeRequest, LooperCloseAllRequest, LooperCloseRequest,
    LooperImportRequest, LooperListRequest, LooperPauseRequest, LooperPreviewRequest,
    LooperStartRequest, LooperStatusRequest, LooperStopRequest, LooperSubmitQuestionsRequest,
};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::registry::{decode_payload, InvokeRegistry, ToolInvokeFuture};
use serde_json::Value;

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("looper", &["start"], invoke_start);
    registry.register("looper", &["stop"], invoke_stop);
    registry.register("looper", &["pause", "set-paused"], invoke_pause);
    registry.register("looper", &["advance"], invoke_advance);
    registry.register("looper", &["status"], invoke_status);
    registry.register("looper", &["list"], invoke_list);
    registry.register("looper", &["close"], invoke_close);
    registry.register("looper", &["close-all"], invoke_close_all);
    registry.register("looper", &["import"], invoke_import);
    registry.register(
        "looper",
        &["check-opencode", "checkOpenCode"],
        invoke_check_opencode,
    );
    registry.register(
        "looper",
        &["submit-questions", "submitQuestions"],
        invoke_submit_questions,
    );
    registry.register("looper", &["start-preview", "startPreview"], invoke_start_preview);
    registry.register("looper", &["stop-preview", "stopPreview"], invoke_stop_preview);
}

fn invoke_start(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperStartRequest = decode_payload(payload)?;
        let result = handler.start(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper start response: {e}"))
    })
}

fn invoke_stop(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperStopRequest = decode_payload(payload)?;
        let result = handler.stop(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper stop response: {e}"))
    })
}

fn invoke_pause(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperPauseRequest = decode_payload(payload)?;
        let result = handler.pause(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper pause response: {e}"))
    })
}

fn invoke_advance(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperAdvanceRequest = decode_payload(payload)?;
        let result = handler.advance(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper advance response: {e}"))
    })
}

fn invoke_status(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperStatusRequest = decode_payload(payload)?;
        let result = handler.status(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper status response: {e}"))
    })
}

fn invoke_list(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperListRequest = decode_payload(payload)?;
        let result = handler.list(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper list response: {e}"))
    })
}

fn invoke_close(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperCloseRequest = decode_payload(payload)?;
        let result = handler.close(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper close response: {e}"))
    })
}

fn invoke_check_opencode(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperCheckOpenCodeRequest = decode_payload(payload)?;
        let result = handler.check_opencode(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper check-opencode response: {e}"))
    })
}

fn invoke_submit_questions(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperSubmitQuestionsRequest = decode_payload(payload)?;
        let result = handler.submit_questions(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper submit-questions response: {e}"))
    })
}

fn invoke_start_preview(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperPreviewRequest = decode_payload(payload)?;
        let result = handler.start_preview(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper start-preview response: {e}"))
    })
}

fn invoke_stop_preview(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperPreviewRequest = decode_payload(payload)?;
        let result = handler.stop_preview(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper stop-preview response: {e}"))
    })
}

fn invoke_close_all(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperCloseAllRequest = decode_payload(payload)?;
        let result = handler.close_all(req).await?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper close-all response: {e}"))
    })
}

fn invoke_import(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let handler = state.looper_handler.clone();
    Box::pin(async move {
        let req: LooperImportRequest = decode_payload(payload)?;
        let result = handler.import(req)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing looper import response: {e}"))
    })
}
