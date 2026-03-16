use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    Stop,
    Length,
    ToolUse,
    Error,
    Interrupted,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
}

impl Usage {
    pub fn total_tokens(&self) -> i64 {
        self.input_tokens + self.output_tokens
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamPart {
    Text { text: String },
    Think { think: String, #[serde(default)] signature: Option<String> },
    ToolCallStart { id: String, name: String, index: usize },
    ToolCallDelta { index: usize, arguments_delta: String },
    Done { stop_reason: StopReason },
    Error { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    Thinking { thinking: String, #[serde(default)] signature: Option<String> },
    Image { data: String, mime_type: String },
    ToolCall { id: String, name: String, arguments: HashMap<String, Value> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum Message {
    User { content: UserContent },
    Assistant {
        content: Vec<ContentPart>,
        #[serde(default)]
        usage: Option<Usage>,
        #[serde(default)]
        stop_reason: Option<StopReason>,
    },
    ToolResult {
        tool_call_id: String,
        tool_name: String,
        content: Vec<ContentPart>,
        #[serde(default)]
        display: Option<String>,
        #[serde(default)]
        is_error: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ToolResult {
    pub success: bool,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub images: Option<Vec<ContentPart>>,
    #[serde(default)]
    pub display: Option<String>,
}
