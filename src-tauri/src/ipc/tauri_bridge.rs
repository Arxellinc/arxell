#![cfg(feature = "tauri-runtime")]

use crate::api_registry::ApiRegistryService;
use crate::app::files_service::FilesService;
use crate::app::model_manager_service::ModelManagerService;
use crate::app::permission_service::PermissionService;
use crate::app::runtime_service::LlamaRuntimeService;
use crate::app::tasks_service::TaskAutomationService;
use crate::app::user_projects_service::UserProjectsService;
use crate::app::voice_runtime_service::VoiceRuntimeService;
use crate::app::web_search_service::WebSearchService;
use crate::contracts::AppEvent;
use crate::ipc::chat::ChatCommandHandler;
use crate::ipc::looper::LooperCommandHandler;
use crate::ipc::terminal::TerminalCommandHandler;
use crate::ipc::voice_commands::VoiceCommandHandler;
use crate::observability::EventHub;
use crate::services::sheets_service::SheetsService;
use crate::workspace_tools::WorkspaceToolsService;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct TauriBridgeState {
    pub chat: Arc<ChatCommandHandler>,
    pub terminal: Arc<TerminalCommandHandler>,
    pub looper_handler: Arc<LooperCommandHandler>,
    pub voice_handler: Arc<VoiceCommandHandler>,
    pub hub: EventHub,
    pub workspace_tools: Arc<WorkspaceToolsService>,
    pub api_registry: Arc<ApiRegistryService>,
    pub web_search: Arc<WebSearchService>,
    pub runtime: Arc<LlamaRuntimeService>,
    pub user_projects: Arc<UserProjectsService>,
    pub permissions: Arc<PermissionService>,
    pub model_manager: Arc<ModelManagerService>,
    pub files: Arc<FilesService>,
    pub tasks: Arc<TaskAutomationService>,
    pub sheets: Arc<SheetsService>,
    pub voice: Arc<VoiceRuntimeService>,
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
