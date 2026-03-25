use crate::contracts::{
    ChatGetMessagesRequest, ChatGetMessagesResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, ChatStreamChunkPayload,
    ChatStreamCompletePayload, ChatStreamStartPayload, ConversationMessageRecord, EventSeverity,
    EventStage, MessageRole, Subsystem, ToolInvokeRequest, ToolMode,
};
use crate::memory::MemoryManager;
use crate::observability::EventHub;
use crate::persistence::ConversationRepository;
use crate::tools::registry::ToolRegistry;
use serde_json::json;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub struct ChatService {
    hub: EventHub,
    registry: Arc<ToolRegistry>,
    memory: Arc<dyn MemoryManager>,
    conversation_repo: Arc<dyn ConversationRepository>,
}

impl ChatService {
    pub fn new(
        hub: EventHub,
        registry: Arc<ToolRegistry>,
        memory: Arc<dyn MemoryManager>,
        conversation_repo: Arc<dyn ConversationRepository>,
    ) -> Self {
        Self {
            hub,
            registry,
            memory,
            conversation_repo,
        }
    }

    pub async fn send_message(&self, req: ChatSendRequest) -> Result<ChatSendResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.send_message",
            EventStage::Start,
            EventSeverity::Info,
            json!({"conversationId": req.conversation_id}),
        ));

        self.memory
            .upsert("episodic", "latest_user_message", &req.user_message);
        self.append_message(
            &req.correlation_id,
            &ConversationMessageRecord {
                conversation_id: req.conversation_id.clone(),
                role: MessageRole::User,
                content: req.user_message.clone(),
                correlation_id: req.correlation_id.clone(),
                timestamp_ms: now_ms(),
            },
        )?;

        let tool_result = match self.registry.invoke(ToolInvokeRequest {
            correlation_id: req.correlation_id.clone(),
            tool_id: "echo".to_string(),
            action: "echo.say".to_string(),
            mode: ToolMode::Sandbox,
            payload: json!({"input": req.user_message}),
        }) {
            Ok(ok) => ok,
            Err(err) => {
                self.hub.emit(self.hub.make_event(
                    &req.correlation_id,
                    Subsystem::Service,
                    "chat.stream.error",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({"message": err.to_string()}),
                ));
                self.hub.emit(self.hub.make_event(
                    &req.correlation_id,
                    Subsystem::Service,
                    "chat.send_message",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({"error": err.to_string()}),
                ));
                return Err(err.to_string());
            }
        };

        let echoed_input = tool_result
            .data
            .get("input")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let assistant_message = format!("Echoed safely via registry: {echoed_input}");

        self.hub.emit(
            self.hub.make_event(
                &req.correlation_id,
                Subsystem::Service,
                "chat.stream.start",
                EventStage::Start,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamStartPayload {
                    conversation_id: req.conversation_id.clone(),
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );

        let mut built = String::new();
        for token in assistant_message.split_whitespace() {
            if !built.is_empty() {
                built.push(' ');
            }
            built.push_str(token);

            self.hub.emit(
                self.hub.make_event(
                    &req.correlation_id,
                    Subsystem::Service,
                    "chat.stream.chunk",
                    EventStage::Progress,
                    EventSeverity::Info,
                    serde_json::to_value(ChatStreamChunkPayload {
                        conversation_id: req.conversation_id.clone(),
                        delta: format!("{token} "),
                        done: false,
                    })
                    .unwrap_or_else(|_| json!({})),
                ),
            );
            sleep(Duration::from_millis(30)).await;
        }

        self.hub.emit(
            self.hub.make_event(
                &req.correlation_id,
                Subsystem::Service,
                "chat.stream.complete",
                EventStage::Complete,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamCompletePayload {
                    conversation_id: req.conversation_id.clone(),
                    assistant_length: built.len(),
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );

        let response = ChatSendResponse {
            conversation_id: req.conversation_id,
            assistant_message,
            correlation_id: req.correlation_id.clone(),
        };
        self.append_message(
            &req.correlation_id,
            &ConversationMessageRecord {
                conversation_id: response.conversation_id.clone(),
                role: MessageRole::Assistant,
                content: response.assistant_message.clone(),
                correlation_id: req.correlation_id.clone(),
                timestamp_ms: now_ms(),
            },
        )?;

        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.send_message",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"assistantLength": response.assistant_message.len()}),
        ));

        Ok(response)
    }

    pub async fn get_messages(
        &self,
        req: ChatGetMessagesRequest,
    ) -> Result<ChatGetMessagesResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.get_messages",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "conversationId": req.conversation_id }),
        ));

        let messages = self
            .conversation_repo
            .list_messages(&req.conversation_id)
            .map_err(|e| {
                self.hub.emit(self.hub.make_event(
                    &req.correlation_id,
                    Subsystem::Persistence,
                    "conversation.list",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({"error": e}),
                ));
                e
            })?;

        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.get_messages",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "count": messages.len() }),
        ));

        Ok(ChatGetMessagesResponse {
            conversation_id: req.conversation_id,
            messages,
            correlation_id: req.correlation_id,
        })
    }

    pub async fn list_conversations(
        &self,
        req: ChatListConversationsRequest,
    ) -> Result<ChatListConversationsResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.list_conversations",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        ));

        let conversations = self.conversation_repo.list_conversations().map_err(|e| {
            self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Persistence,
                "conversation.list",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": e}),
            ));
            e
        })?;

        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.list_conversations",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "count": conversations.len() }),
        ));

        Ok(ChatListConversationsResponse {
            conversations,
            correlation_id: req.correlation_id,
        })
    }

    fn append_message(
        &self,
        correlation_id: &str,
        message: &ConversationMessageRecord,
    ) -> Result<(), String> {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Persistence,
            "conversation.append",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "conversationId": message.conversation_id, "role": message.role }),
        ));
        self.conversation_repo
            .append_message(message)
            .map_err(|e| {
                self.hub.emit(self.hub.make_event(
                    correlation_id,
                    Subsystem::Persistence,
                    "conversation.append",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({"error": e}),
                ));
                e
            })?;
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Persistence,
            "conversation.append",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "ok": true }),
        ));
        Ok(())
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
