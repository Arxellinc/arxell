pub mod chat_service;
pub mod model_manager_service;
pub mod permission_service;
pub mod runtime_service;
#[cfg(feature = "tauri-runtime")]
pub mod stt_service;
pub mod terminal_service;
#[cfg(feature = "tauri-runtime")]
pub mod tts_service;

use crate::ipc::IpcLayer;
use crate::memory::InMemoryMemoryManager;
use crate::observability::EventHub;
use crate::persistence::SqliteConversationRepository;
use crate::workspace_tools::WorkspaceToolsService;
use std::sync::Arc;

pub struct AppContext {
    pub ipc: IpcLayer,
    pub workspace_tools: Arc<WorkspaceToolsService>,
    pub runtime: Arc<runtime_service::LlamaRuntimeService>,
    pub permissions: Arc<permission_service::PermissionService>,
    pub model_manager: Arc<model_manager_service::ModelManagerService>,
    #[cfg(feature = "tauri-runtime")]
    pub stt: Arc<stt_service::SttService>,
    #[cfg(feature = "tauri-runtime")]
    pub tts: Arc<tts_service::TtsService>,
}

impl AppContext {
    pub fn new() -> Self {
        let hub = EventHub::new();
        let memory = Arc::new(InMemoryMemoryManager::new());
        let conversation_repo = Arc::new(
            SqliteConversationRepository::new(SqliteConversationRepository::default_path())
                .expect("failed to initialize conversation repository"),
        );

        let service = Arc::new(chat_service::ChatService::new(
            hub.clone(),
            memory,
            conversation_repo,
        ));
        let terminal = Arc::new(terminal_service::TerminalService::new(hub.clone()));
        let workspace_tools = Arc::new(WorkspaceToolsService::new());
        let runtime = Arc::new(runtime_service::LlamaRuntimeService::new(hub.clone()));
        let permissions = Arc::new(permission_service::PermissionService::new(hub.clone()));
        let model_manager = Arc::new(model_manager_service::ModelManagerService::new(hub.clone()));
        #[cfg(feature = "tauri-runtime")]
        let stt = Arc::new(stt_service::SttService::new(hub.clone()));
        #[cfg(feature = "tauri-runtime")]
        let tts = Arc::new(tts_service::TtsService::new(hub.clone()));

        let ipc = IpcLayer::new(hub, service, terminal);
        Self {
            ipc,
            workspace_tools,
            runtime,
            permissions,
            model_manager,
            #[cfg(feature = "tauri-runtime")]
            stt,
            #[cfg(feature = "tauri-runtime")]
            tts,
        }
    }
}

impl Default for AppContext {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "tauri-runtime")]
impl AppContext {
    pub fn tauri_bridge_state(&self) -> crate::ipc::tauri_bridge::TauriBridgeState {
        crate::ipc::tauri_bridge::TauriBridgeState {
            chat: Arc::new(self.ipc.chat.clone()),
            terminal: Arc::new(self.ipc.terminal.clone()),
            hub: self.ipc.event_hub(),
            workspace_tools: Arc::clone(&self.workspace_tools),
            runtime: Arc::clone(&self.runtime),
            permissions: Arc::clone(&self.permissions),
            model_manager: Arc::clone(&self.model_manager),
            stt: Arc::clone(&self.stt),
            tts: Arc::clone(&self.tts),
        }
    }
}
