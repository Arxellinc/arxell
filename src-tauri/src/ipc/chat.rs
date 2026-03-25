use crate::app::chat_service::ChatService;
use crate::contracts::{
    ChatGetMessagesRequest, ChatGetMessagesResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, EventSeverity, EventStage,
    Subsystem,
};
use crate::observability::EventHub;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct ChatCommandHandler {
    hub: EventHub,
    service: Arc<ChatService>,
}

impl ChatCommandHandler {
    pub fn new(hub: EventHub, service: Arc<ChatService>) -> Self {
        Self { hub, service }
    }

    pub async fn send_message(&self, req: ChatSendRequest) -> Result<ChatSendResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.chat.send_message",
            EventStage::Start,
            EventSeverity::Info,
            json!({"conversationId": req.conversation_id}),
        ));

        let result = self.service.send_message(req.clone()).await;

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.send_message",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"ok": true}),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.send_message",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err}),
            )),
        }

        result
    }

    pub async fn get_messages(
        &self,
        req: ChatGetMessagesRequest,
    ) -> Result<ChatGetMessagesResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.chat.get_messages",
            EventStage::Start,
            EventSeverity::Info,
            json!({"conversationId": req.conversation_id}),
        ));

        let result = self.service.get_messages(req.clone()).await;

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.get_messages",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"count": response.messages.len()}),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.get_messages",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err}),
            )),
        }

        result
    }

    pub async fn list_conversations(
        &self,
        req: ChatListConversationsRequest,
    ) -> Result<ChatListConversationsResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.chat.list_conversations",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        ));

        let result = self.service.list_conversations(req.clone()).await;

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.list_conversations",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"count": response.conversations.len()}),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.list_conversations",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err}),
            )),
        }

        result
    }
}
