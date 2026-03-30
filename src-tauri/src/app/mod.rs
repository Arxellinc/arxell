pub mod chat_service;
pub mod model_manager_service;
pub mod permission_service;
pub mod runtime_service;
pub mod terminal_service;
pub mod web_search_service;

use crate::api_registry::ApiRegistryService;
use crate::ipc::IpcLayer;
use crate::memory::InMemoryMemoryManager;
use crate::observability::EventHub;
use crate::persistence::SqliteConversationRepository;
use crate::workspace_tools::WorkspaceToolsService;
use std::sync::Arc;

pub struct AppContext {
    pub ipc: IpcLayer,
    pub workspace_tools: Arc<WorkspaceToolsService>,
    pub api_registry: Arc<ApiRegistryService>,
    pub web_search: Arc<web_search_service::WebSearchService>,
    pub runtime: Arc<runtime_service::LlamaRuntimeService>,
    pub permissions: Arc<permission_service::PermissionService>,
    pub model_manager: Arc<model_manager_service::ModelManagerService>,
}

impl AppContext {
    pub fn new() -> Self {
        let hub = EventHub::new();
        let memory = Arc::new(InMemoryMemoryManager::new());
        let conversation_repo = Arc::new(
            SqliteConversationRepository::new(SqliteConversationRepository::default_path())
                .expect("failed to initialize conversation repository"),
        );
        let api_registry = Arc::new(ApiRegistryService::new());
        let workspace_tools = Arc::new(WorkspaceToolsService::new());
        let web_search = Arc::new(web_search_service::WebSearchService::new(Arc::clone(
            &api_registry,
        )));

        let service = Arc::new(chat_service::ChatService::new(
            hub.clone(),
            memory,
            conversation_repo,
            Arc::clone(&api_registry),
            Arc::clone(&workspace_tools),
            Arc::clone(&web_search),
        ));
        let terminal = Arc::new(terminal_service::TerminalService::new(hub.clone()));
        let runtime = Arc::new(runtime_service::LlamaRuntimeService::new(hub.clone()));
        let permissions = Arc::new(permission_service::PermissionService::new(hub.clone()));
        let model_manager = Arc::new(model_manager_service::ModelManagerService::new(hub.clone()));

        let ipc = IpcLayer::new(hub, service, terminal);
        Self {
            ipc,
            workspace_tools,
            api_registry,
            web_search,
            runtime,
            permissions,
            model_manager,
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
            api_registry: Arc::clone(&self.api_registry),
            web_search: Arc::clone(&self.web_search),
            runtime: Arc::clone(&self.runtime),
            permissions: Arc::clone(&self.permissions),
            model_manager: Arc::clone(&self.model_manager),
        }
    }
}
