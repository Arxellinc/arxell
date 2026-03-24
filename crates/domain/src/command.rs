use crate::{ConversationId, CorrelationId, MessageId, RunId, UserInput};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppCommand {
    SendMessage {
        correlation_id: CorrelationId,
        message_id: MessageId,
        input: UserInput,
    },
    CancelRun {
        correlation_id: CorrelationId,
        run_id: RunId,
    },
    LoadConversation {
        correlation_id: CorrelationId,
        conversation_id: ConversationId,
    },
}
