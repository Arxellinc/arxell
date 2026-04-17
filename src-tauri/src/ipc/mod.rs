pub mod bridge;
pub mod chat;
pub mod flow;
pub mod looper;
#[cfg(feature = "tauri-runtime")]
pub mod tauri_bridge;
pub mod terminal;
#[cfg(feature = "tauri-runtime")]
pub mod tool_runtime;
pub mod voice_commands;

use crate::app::chat_service::ChatService;
use crate::app::flow_service::FlowService;
use crate::app::terminal_service::TerminalService;
use crate::app::voice_runtime_service::VoiceRuntimeService;
use crate::contracts::AppEvent;
use crate::observability::EventHub;
use crate::tools::looper_handler::LooperHandler;
use std::sync::Arc;

pub struct IpcLayer {
    pub chat: chat::ChatCommandHandler,
    pub terminal: terminal::TerminalCommandHandler,
    pub flow: flow::FlowCommandHandler,
    pub looper: looper::LooperCommandHandler,
    pub voice: voice_commands::VoiceCommandHandler,
    hub: EventHub,
}

impl IpcLayer {
    pub fn new(
        hub: EventHub,
        service: Arc<ChatService>,
        terminal: Arc<TerminalService>,
        flow: Arc<FlowService>,
        looper: Arc<LooperHandler>,
        voice: Arc<VoiceRuntimeService>,
    ) -> Self {
        Self {
            chat: chat::ChatCommandHandler::new(hub.clone(), service),
            terminal: terminal::TerminalCommandHandler::new(hub.clone(), terminal),
            flow: flow::FlowCommandHandler::new(hub.clone(), flow),
            looper: looper::LooperCommandHandler::new(hub.clone(), looper),
            voice: voice_commands::VoiceCommandHandler::new(hub.clone(), voice),
            hub,
        }
    }

    pub fn event_stream(&self) -> tokio::sync::broadcast::Receiver<AppEvent> {
        self.hub.subscribe()
    }

    pub fn event_hub(&self) -> EventHub {
        self.hub.clone()
    }
}
