use crate::{CorrelationId, MessageId, RunId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    ChatStarted {
        correlation_id: CorrelationId,
        run_id: RunId,
        assistant_message_id: MessageId,
    },
    TokenReceived {
        correlation_id: CorrelationId,
        run_id: RunId,
        delta: String,
    },
    ToolCallStarted {
        correlation_id: CorrelationId,
        run_id: RunId,
        tool_call_id: String,
        tool_id: String,
    },
    ToolCallFinished {
        correlation_id: CorrelationId,
        run_id: RunId,
        tool_call_id: String,
    },
    ErrorOccurred {
        correlation_id: CorrelationId,
        run_id: Option<RunId>,
        message: String,
    },
}
