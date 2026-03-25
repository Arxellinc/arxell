#![cfg(feature = "tauri-runtime")]

use crate::app::runtime_service::LlamaRuntimeService;
use crate::contracts::AppEvent;
use crate::ipc::chat::ChatCommandHandler;
use crate::ipc::terminal::TerminalCommandHandler;
use crate::observability::EventHub;
use crate::workspace_tools::WorkspaceToolsService;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct TauriBridgeState {
    pub chat: Arc<ChatCommandHandler>,
    pub terminal: Arc<TerminalCommandHandler>,
    pub hub: EventHub,
    pub workspace_tools: Arc<WorkspaceToolsService>,
    pub runtime: Arc<LlamaRuntimeService>,
}

pub fn attach_event_forwarder(app: AppHandle, hub: EventHub) {
    let mut rx = hub.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let _ = emit_app_event(&app, &event);
        }
    });
}

fn emit_app_event(app: &AppHandle, event: &AppEvent) -> Result<(), String> {
    app.emit("app:event", event)
        .map_err(|e| format!("failed to emit app:event: {e}"))
}
