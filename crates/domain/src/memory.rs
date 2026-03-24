use crate::{ConversationId, DomainError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryCandidate {
    pub kind: String,
    pub content: String,
    pub source_conversation_id: ConversationId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryItem {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub confidence_basis_points: u16,
}

pub trait MemoryStore: Send + Sync {
    fn save(&self, candidate: MemoryCandidate) -> Result<String, DomainError>;
}

pub trait MemoryRetriever: Send + Sync {
    fn retrieve(
        &self,
        conversation_id: &ConversationId,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryItem>, DomainError>;
}
