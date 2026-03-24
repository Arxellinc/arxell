use crate::DomainError;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConversationId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MessageId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RunId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CorrelationId(String);

macro_rules! impl_id {
    ($name:ident, $field:literal) => {
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(DomainError::validation($field, "must not be empty"));
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

impl_id!(ConversationId, "conversation_id");
impl_id!(MessageId, "message_id");
impl_id!(RunId, "run_id");
impl_id!(CorrelationId, "correlation_id");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub id: MessageId,
    pub conversation_id: ConversationId,
    pub role: MessageRole,
    pub content: String,
}

impl ChatMessage {
    pub fn new(
        id: MessageId,
        conversation_id: ConversationId,
        role: MessageRole,
        content: impl Into<String>,
    ) -> Result<Self, DomainError> {
        let content = content.into();
        if content.trim().is_empty() {
            return Err(DomainError::validation("content", "must not be empty"));
        }
        Ok(Self {
            id,
            conversation_id,
            role,
            content,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInput {
    pub conversation_id: ConversationId,
    pub content: String,
}

impl UserInput {
    pub fn new(
        conversation_id: ConversationId,
        content: impl Into<String>,
    ) -> Result<Self, DomainError> {
        let content = content.into();
        if content.trim().is_empty() {
            return Err(DomainError::validation("content", "must not be empty"));
        }
        Ok(Self {
            conversation_id,
            content,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_rejects_empty() {
        let id = ConversationId::new("   ");
        assert!(id.is_err());
    }

    #[test]
    fn chat_message_rejects_empty_content() {
        let id = MessageId::new("m1").unwrap();
        let convo = ConversationId::new("c1").unwrap();
        let msg = ChatMessage::new(id, convo, MessageRole::User, " ");
        assert!(msg.is_err());
    }

    #[test]
    fn user_input_accepts_valid_content() {
        let convo = ConversationId::new("c1").unwrap();
        let input = UserInput::new(convo, "hello").unwrap();
        assert_eq!(input.content, "hello");
    }

    #[test]
    fn contract_id_constructors_reject_whitespace_only_values() {
        assert!(ConversationId::new("   ").is_err());
        assert!(MessageId::new("\t").is_err());
        assert!(RunId::new("\n").is_err());
        assert!(CorrelationId::new(" ").is_err());
    }

    #[test]
    fn contract_chat_message_requires_non_empty_content() {
        let id = MessageId::new("m-contract").unwrap();
        let convo = ConversationId::new("c-contract").unwrap();
        let msg = ChatMessage::new(id, convo, MessageRole::User, "");
        assert!(msg.is_err());
    }
}
