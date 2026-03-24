use crate::{ChatMessage, DomainError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderResponse {
    pub content: String,
}

pub trait TokenSink {
    fn on_token(&mut self, delta: &str) -> Result<(), DomainError>;
}

pub trait ChatProvider: Send + Sync {
    fn stream_chat(
        &self,
        request: ProviderRequest,
        sink: &mut dyn TokenSink,
    ) -> Result<ProviderResponse, DomainError>;
}
