pub mod mock;
pub mod openai_compatible;

use async_trait::async_trait;
use futures_util::stream::BoxStream;

use crate::types::{Message, StreamPart, ToolDefinition, Usage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: String,
    pub max_tokens: i64,
    pub temperature: Option<f64>,
    pub thinking_level: String,
    pub provider: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: None,
            model: "gpt-4.1".to_string(),
            max_tokens: 8192,
            temperature: None,
            thinking_level: "medium".to_string(),
            provider: Some("openai".to_string()),
        }
    }
}

pub struct ProviderStream {
    pub stream: BoxStream<'static, Result<StreamPart, String>>,
    pub usage: Usage,
    pub id: Option<String>,
}

#[async_trait]
pub trait Provider: Send + Sync {
    fn name(&self) -> &'static str;
    fn config(&self) -> &ProviderConfig;
    fn config_mut(&mut self) -> &mut ProviderConfig;

    fn thinking_levels(&self) -> Vec<&'static str> {
        vec!["none", "low", "medium", "high"]
    }

    fn should_retry_for_error(&self, _error: &str) -> bool {
        false
    }

    async fn stream(
        &self,
        messages: Vec<Message>,
        system_prompt: Option<String>,
        tools: Option<Vec<ToolDefinition>>,
        temperature: Option<f64>,
        max_tokens: Option<i64>,
    ) -> Result<ProviderStream, String>;

    fn cycle_thinking_level(&mut self) -> String {
        let levels = self.thinking_levels();
        let current = self.config().thinking_level.clone();
        let idx = levels.iter().position(|l| *l == current).unwrap_or(0);
        let next = levels[(idx + 1) % levels.len()].to_string();
        self.config_mut().thinking_level = next.clone();
        next
    }
}
