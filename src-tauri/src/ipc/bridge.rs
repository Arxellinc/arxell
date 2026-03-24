use crate::contracts::AppEvent;
use crate::observability::EventHub;

pub trait IpcEventSink: Send + Sync {
    fn emit_event(&self, event: &AppEvent);
}

#[derive(Clone)]
pub struct InternalEventSink {
    hub: EventHub,
}

impl InternalEventSink {
    pub fn new(hub: EventHub) -> Self {
        Self { hub }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AppEvent> {
        self.hub.subscribe()
    }
}

impl IpcEventSink for InternalEventSink {
    fn emit_event(&self, event: &AppEvent) {
        self.hub.emit(event.clone());
    }
}

// Tauri integration target contract (implemented when tauri runtime is added):
// - command name: cmd_chat_send_message
// - event name: app:event
// - payload: AppEvent JSON envelope
