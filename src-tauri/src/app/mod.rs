pub mod chat_service;
pub mod files_service;
pub mod flow_service;
pub mod model_manager_service;
pub mod permission_service;
pub mod runtime_service;
pub mod terminal_service;
pub mod voice_handoff_service;
pub mod voice_runtime_service;
pub mod voice_speculation_service;
pub mod web_search_service;

use crate::api_registry::ApiRegistryService;
use crate::ipc::IpcLayer;
use crate::memory::InMemoryMemoryManager;
use crate::observability::EventHub;
use crate::persistence::SqliteConversationRepository;
use crate::services::sheets_service::SheetsService;
use crate::tools::looper_handler::LooperHandler;
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
    pub files: Arc<files_service::FilesService>,
    pub sheets: Arc<SheetsService>,
    pub flow: Arc<flow_service::FlowService>,
    pub looper: Arc<LooperHandler>,
    pub voice: Arc<voice_runtime_service::VoiceRuntimeService>,
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
        let sheets = Arc::new(SheetsService::new(Some(hub.clone()), Arc::clone(&api_registry)));

        let service = Arc::new(chat_service::ChatService::new(
            hub.clone(),
            memory,
            conversation_repo,
            Arc::clone(&api_registry),
            Arc::clone(&workspace_tools),
            Arc::clone(&sheets),
            Arc::clone(&web_search),
        ));
        let terminal = Arc::new(terminal_service::TerminalService::new(hub.clone()));
        let runtime = Arc::new(runtime_service::LlamaRuntimeService::new(hub.clone()));
        let permissions = Arc::new(permission_service::PermissionService::new(hub.clone()));
        let model_manager = Arc::new(model_manager_service::ModelManagerService::new(hub.clone()));
        let files = Arc::new(files_service::FilesService::new());
        let flow = Arc::new(flow_service::FlowService::new_with_registry(
            hub.clone(),
            Some(Arc::clone(&api_registry)),
            Some(Arc::clone(&workspace_tools)),
            Some(Arc::clone(&web_search)),
        ));
        let looper = Arc::new(LooperHandler::new(
            hub.clone(),
            Arc::clone(&terminal),
            Arc::clone(&workspace_tools),
        ));
        looper.set_data_path(workspace_tools.state_root_path().join("looper-state.json"));
        looper.load_from_disk();
        #[cfg(feature = "tauri-runtime")]
        looper.start_event_listener();
        let voice = Arc::new(voice_runtime_service::VoiceRuntimeService::new(hub.clone()));

        let ipc = IpcLayer::new(
            hub,
            service,
            Arc::clone(&terminal),
            Arc::clone(&flow),
            Arc::clone(&looper),
            Arc::clone(&voice),
        );
        Self {
            ipc,
            workspace_tools,
            api_registry,
            web_search,
            runtime,
            permissions,
            model_manager,
            files,
            sheets,
            flow,
            looper,
            voice,
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
            flow_handler: Arc::new(self.ipc.flow.clone()),
            looper_handler: Arc::new(self.ipc.looper.clone()),
            voice_handler: Arc::new(self.ipc.voice.clone()),
            hub: self.ipc.event_hub(),
            workspace_tools: Arc::clone(&self.workspace_tools),
            api_registry: Arc::clone(&self.api_registry),
            web_search: Arc::clone(&self.web_search),
            runtime: Arc::clone(&self.runtime),
            permissions: Arc::clone(&self.permissions),
            model_manager: Arc::clone(&self.model_manager),
            files: Arc::clone(&self.files),
            sheets: Arc::clone(&self.sheets),
            flow: Arc::clone(&self.flow),
            voice: Arc::clone(&self.voice),
        }
    }
}
