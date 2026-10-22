#![cfg(feature = "tauri-runtime")]

use crate::api_registry::ApiRegistryService;
use crate::app::files_service::FilesService;
use crate::app::image_generation_service::ImageGenerationService;
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
use crate::observability::{EventHub, EventSubscription};
use crate::services::sheets_service::SheetsService;
use crate::workspace_tools::WorkspaceToolsService;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
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
    pub image_generation: Arc<ImageGenerationService>,
    pub tasks: Arc<TaskAutomationService>,
    pub sheets: Arc<SheetsService>,
    pub voice: Arc<VoiceRuntimeService>,
}

pub fn attach_event_forwarder(app: AppHandle, hub: EventHub) {
    let rx = hub.subscribe_resilient("renderer");
    tauri::async_runtime::spawn(forward_events(rx, move |event| {
        let _ = emit_app_event(&app, event);
    }));
}

async fn forward_events(mut rx: EventSubscription, mut emit: impl FnMut(&AppEvent)) {
    while let Some(event) = rx.recv().await {
        rx.take_skipped();
        emit(&event);
    }
}

fn emit_app_event(app: &AppHandle, event: &AppEvent) -> Result<(), String> {
    app.emit("app:event", event)
        .map_err(|e| format!("failed to emit app:event: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{EventSeverity, EventStage, Subsystem};
    use serde_json::json;

    #[tokio::test]
    async fn forwarder_survives_a_burst_then_forwards_new_events_until_closed() {
        let hub = EventHub::new();
        let rx = hub.subscribe_resilient("renderer-test");
        for _ in 0..2000 {
            hub.emit(hub.make_event(
                "burst",
                Subsystem::Service,
                "terminal.output",
                EventStage::Progress,
                EventSeverity::Info,
                json!({}),
            ));
        }
        let (tx, mut forwarded) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(forward_events(rx, move |event| {
            tx.send(event.action.clone()).unwrap();
        }));
        // Wait for the buffered tail, proving the overflow did not end forwarding.
        for _ in 0..512 {
            assert_eq!(
                tokio::time::timeout(std::time::Duration::from_secs(1), forwarded.recv())
                    .await
                    .unwrap()
                    .unwrap(),
                "terminal.output"
            );
        }
        hub.emit(hub.make_event(
            "future",
            Subsystem::Service,
            "terminal.exit",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"sessionId": "term-test"}),
        ));
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), forwarded.recv())
                .await
                .unwrap()
                .unwrap(),
            "terminal.exit"
        );
        drop(hub);
        tokio::time::timeout(std::time::Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
    }
}
