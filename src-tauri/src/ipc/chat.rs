use crate::app::chat_service::ChatService;
use crate::contracts::{
    ChatCancelRequest, ChatCancelResponse, ChatDeleteConversationRequest,
    ChatDeleteConversationResponse, ChatGetMessagesRequest, ChatGetMessagesResponse,
    ChatInspectContextRequest, ChatInspectContextResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, CustomItemDeleteRequest,
    CustomItemDeleteResponse, CustomItemUpsertRequest, CustomItemUpsertResponse, EventSeverity,
    EventStage, MemoryDeleteRequest, MemoryDeleteResponse, MemoryUpsertRequest,
    MemoryUpsertResponse, ReferenceFileSetRequest, ReferenceFileSetResponse, SkillCreateRequest,
    SkillCreateResponse, Subsystem, SystemPromptSetRequest, SystemPromptSetResponse,
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

    pub async fn cancel_message(
        &self,
        req: ChatCancelRequest,
    ) -> Result<ChatCancelResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.chat.cancel_message",
            EventStage::Start,
            EventSeverity::Info,
            json!({"targetCorrelationId": req.target_correlation_id}),
        ));

        let result = self
            .service
            .cancel_message(
                req.correlation_id.as_str(),
                req.target_correlation_id.as_str(),
            )
            .await;

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.cancel_message",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"cancelled": response.cancelled}),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.cancel_message",
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

    pub async fn inspect_context(
        &self,
        req: ChatInspectContextRequest,
    ) -> Result<ChatInspectContextResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.chat.inspect_context",
            EventStage::Start,
            EventSeverity::Info,
            json!({"conversationId": req.conversation_id}),
        ));

        let result = self.service.inspect_context(req.clone()).await;

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.inspect_context",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "itemCount": response.items.len(),
                    "totalTokenEstimate": response.total_token_estimate
                }),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.inspect_context",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err}),
            )),
        }

        result
    }

    pub async fn upsert_memory(
        &self,
        req: MemoryUpsertRequest,
    ) -> Result<MemoryUpsertResponse, String> {
        self.service.upsert_memory(req).await
    }

    pub async fn delete_memory(
        &self,
        req: MemoryDeleteRequest,
    ) -> Result<MemoryDeleteResponse, String> {
        self.service.delete_memory(req).await
    }

    pub async fn set_system_prompt(
        &self,
        req: SystemPromptSetRequest,
    ) -> Result<SystemPromptSetResponse, String> {
        self.service.set_system_prompt(req).await
    }

    pub async fn upsert_custom_item(
        &self,
        req: CustomItemUpsertRequest,
    ) -> Result<CustomItemUpsertResponse, String> {
        self.service.upsert_custom_item(req).await
    }

    pub async fn delete_custom_item(
        &self,
        req: CustomItemDeleteRequest,
    ) -> Result<CustomItemDeleteResponse, String> {
        self.service.delete_custom_item(req).await
    }

    pub async fn create_skill(
        &self,
        req: SkillCreateRequest,
    ) -> Result<SkillCreateResponse, String> {
        self.service.create_skill(req).await
    }

    pub async fn set_reference_file(
        &self,
        req: ReferenceFileSetRequest,
    ) -> Result<ReferenceFileSetResponse, String> {
        self.service.set_reference_file(req).await
    }

    pub async fn delete_conversation(
        &self,
        req: ChatDeleteConversationRequest,
    ) -> Result<ChatDeleteConversationResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.chat.delete_conversation",
            EventStage::Start,
            EventSeverity::Info,
            json!({"conversationId": req.conversation_id}),
        ));

        let result = self
            .service
            .delete_conversation(req.correlation_id.as_str(), req.conversation_id.as_str())
            .await;

        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.delete_conversation",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"deleted": response.deleted}),
            )),
            Err(err) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.chat.delete_conversation",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err}),
            )),
        }

        result
    }
}
