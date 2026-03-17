use crate::types::{Message, StopReason, ToolResult, Usage};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    AgentStart,
    AgentEnd {
        stop_reason: StopReason,
        total_turns: i64,
        total_usage: Usage,
    },
    TurnStart {
        turn: i64,
    },
    TurnEnd {
        turn: i64,
        assistant_message: Option<Message>,
        tool_results: Vec<Message>,
        stop_reason: StopReason,
    },
    ThinkingStart,
    ThinkingDelta {
        delta: String,
    },
    ThinkingEnd {
        thinking: String,
        signature: Option<String>,
    },
    TextStart,
    TextDelta {
        delta: String,
    },
    TextEnd {
        text: String,
    },
    ToolStart {
        tool_call_id: String,
        tool_name: String,
    },
    ToolArgsDelta {
        tool_call_id: String,
        delta: String,
    },
    ToolArgsTokenUpdate {
        tool_call_id: String,
        tool_name: String,
        token_count: i64,
    },
    ToolEnd {
        tool_call_id: String,
        tool_name: String,
        arguments: Value,
        display: String,
    },
    ToolResult {
        tool_call_id: String,
        tool_name: String,
        result: Option<ToolResult>,
    },
    CompactionStart,
    CompactionEnd {
        tokens_before: i64,
        aborted: bool,
    },
    Retry {
        attempt: i64,
        total_attempts: i64,
        delay: f64,
        error: String,
    },
    Error {
        error: String,
    },
    Warning {
        warning: String,
    },
    Interrupted {
        message: String,
    },
}
