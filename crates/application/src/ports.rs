use arx_domain::{AppEvent, ChatMessage, ConversationId, CorrelationId, DomainError, RunId};

pub trait MessageStore: Send + Sync {
    fn append_message(&self, message: ChatMessage) -> Result<(), DomainError>;

    fn list_messages(
        &self,
        conversation_id: &ConversationId,
    ) -> Result<Vec<ChatMessage>, DomainError>;
}

pub trait RunStore: Send + Sync {
    fn start_run(&self, run_id: RunId, correlation_id: CorrelationId) -> Result<(), DomainError>;

    fn cancel_run(&self, run_id: &RunId) -> Result<bool, DomainError>;
}

pub trait EventPublisher: Send + Sync {
    fn publish(&self, event: AppEvent) -> Result<(), DomainError>;
}
