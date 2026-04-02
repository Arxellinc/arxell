pub mod bridge;
pub mod chat;
pub mod flow;
#[cfg(feature = "tauri-runtime")]
pub mod tool_runtime;
#[cfg(feature = "tauri-runtime")]
pub mod tauri_bridge;
pub mod terminal;

use crate::app::chat_service::ChatService;
use crate::app::flow_service::FlowService;
use crate::app::terminal_service::TerminalService;
use crate::contracts::AppEvent;
use crate::observability::EventHub;
use std::sync::Arc;

pub struct IpcLayer {
    pub chat: chat::ChatCommandHandler,
    pub terminal: terminal::TerminalCommandHandler,
    pub flow: flow::FlowCommandHandler,
    hub: EventHub,
}

impl IpcLayer {
    pub fn new(
        hub: EventHub,
        service: Arc<ChatService>,
        terminal: Arc<TerminalService>,
        flow: Arc<FlowService>,
    ) -> Self {
        Self {
            chat: chat::ChatCommandHandler::new(hub.clone(), service),
            terminal: terminal::TerminalCommandHandler::new(hub.clone(), terminal),
            flow: flow::FlowCommandHandler::new(hub.clone(), flow),
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
