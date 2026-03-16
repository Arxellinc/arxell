use async_trait::async_trait;
use futures_util::stream;

use crate::provider::{Provider, ProviderConfig, ProviderStream};
use crate::types::{Message, StopReason, StreamPart, ToolDefinition, Usage};

#[derive(Debug, Clone)]
pub struct MockProvider {
    pub config: ProviderConfig,
    pub scenario: String,
}

impl Default for MockProvider {
    fn default() -> Self {
        Self {
            config: ProviderConfig::default(),
            scenario: "default".to_string(),
        }
    }
}

#[async_trait]
impl Provider for MockProvider {
    fn name(&self) -> &'static str {
        "mock"
    }

    fn config(&self) -> &ProviderConfig {
        &self.config
    }

    fn config_mut(&mut self) -> &mut ProviderConfig {
        &mut self.config
    }

    fn should_retry_for_error(&self, error: &str) -> bool {
        error.contains("Rate limit") || error.contains("Always fails")
    }

    async fn stream(
        &self,
        _messages: Vec<Message>,
        _system_prompt: Option<String>,
        _tools: Option<Vec<ToolDefinition>>,
        _temperature: Option<f64>,
        _max_tokens: Option<i64>,
    ) -> Result<ProviderStream, String> {
        let parts = match self.scenario.as_str() {
            "simple_text" => vec![
                Ok(StreamPart::Text {
                    text: "Hello, world!".to_string(),
                }),
                Ok(StreamPart::Done {
                    stop_reason: StopReason::Stop,
                }),
            ],
            "thinking_text_tool" => vec![
                Ok(StreamPart::Think {
                    think: "I need to read the file".to_string(),
                    signature: None,
                }),
                Ok(StreamPart::Text {
                    text: "Let me check the file.".to_string(),
                }),
                Ok(StreamPart::ToolCallStart {
                    id: "call-1".to_string(),
                    name: "read".to_string(),
                    index: 0,
                }),
                Ok(StreamPart::ToolCallDelta {
                    index: 0,
                    arguments_delta: "{\"path\":\"test.txt\"}".to_string(),
                }),
                Ok(StreamPart::Done {
                    stop_reason: StopReason::ToolUse,
                }),
            ],
            _ => vec![
                Ok(StreamPart::Think {
                    think: "Let me think about this...".to_string(),
                    signature: None,
                }),
                Ok(StreamPart::Text {
                    text: "I'll help you with that.".to_string(),
                }),
                Ok(StreamPart::ToolCallStart {
                    id: "call-1".to_string(),
                    name: "read".to_string(),
                    index: 0,
                }),
                Ok(StreamPart::ToolCallDelta {
                    index: 0,
                    arguments_delta: "{\"path\":\"file.txt\"}".to_string(),
                }),
                Ok(StreamPart::ToolCallStart {
                    id: "call-2".to_string(),
                    name: "bash".to_string(),
                    index: 1,
                }),
                Ok(StreamPart::ToolCallDelta {
                    index: 1,
                    arguments_delta: "{\"command\":\"ls -la\"}".to_string(),
                }),
                Ok(StreamPart::Done {
                    stop_reason: StopReason::ToolUse,
                }),
            ],
        };

        Ok(ProviderStream {
            stream: Box::pin(stream::iter(parts)),
            usage: Usage {
                input_tokens: 10,
                output_tokens: 5,
                cache_read_tokens: 2,
                cache_write_tokens: 0,
            },
            id: Some("mock-1".to_string()),
        })
    }
}
