use arx_domain::{ConversationId, DomainError, MemoryCandidate, MemoryStore};

pub trait MemoryExtractionFlag: Send + Sync {
    fn enabled(&self) -> bool;
}

pub struct ExtractMemoryInput {
    pub source_conversation_id: ConversationId,
    pub kind: String,
    pub content: String,
}

pub struct ExtractMemoryResult {
    pub saved_memory_id: Option<String>,
    pub skipped_by_feature_flag: bool,
}

pub struct ExtractMemoryUseCase<'a> {
    pub memory_store: &'a dyn MemoryStore,
    pub extraction_flag: &'a dyn MemoryExtractionFlag,
}

impl<'a> ExtractMemoryUseCase<'a> {
    pub fn execute(&self, input: ExtractMemoryInput) -> Result<ExtractMemoryResult, DomainError> {
        if !self.extraction_flag.enabled() {
            return Ok(ExtractMemoryResult {
                saved_memory_id: None,
                skipped_by_feature_flag: true,
            });
        }

        let kind = input.kind.trim().to_string();
        if kind.is_empty() {
            return Err(DomainError::validation("kind", "must not be empty"));
        }
        let content = input.content.trim().to_string();
        if content.is_empty() {
            return Err(DomainError::validation("content", "must not be empty"));
        }

        let id = self.memory_store.save(MemoryCandidate {
            kind,
            content,
            source_conversation_id: input.source_conversation_id,
        })?;
        Ok(ExtractMemoryResult {
            saved_memory_id: Some(id),
            skipped_by_feature_flag: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use arx_domain::{ConversationId, DomainError, MemoryCandidate, MemoryStore};

    use super::{ExtractMemoryInput, ExtractMemoryUseCase, MemoryExtractionFlag};

    struct FakeFlag {
        enabled: bool,
    }

    impl MemoryExtractionFlag for FakeFlag {
        fn enabled(&self) -> bool {
            self.enabled
        }
    }

    struct FakeStore {
        saved: Mutex<Vec<MemoryCandidate>>,
    }

    impl MemoryStore for FakeStore {
        fn save(&self, candidate: MemoryCandidate) -> Result<String, DomainError> {
            let mut saved = self.saved.lock().map_err(|_| DomainError::Internal {
                reason: "saved lock poisoned".to_string(),
            })?;
            saved.push(candidate);
            Ok("mem-1".to_string())
        }
    }

    #[test]
    fn contract_extraction_is_guarded_by_feature_flag() {
        let store = FakeStore {
            saved: Mutex::new(Vec::new()),
        };
        let flag = FakeFlag { enabled: false };
        let use_case = ExtractMemoryUseCase {
            memory_store: &store,
            extraction_flag: &flag,
        };
        let result = use_case
            .execute(ExtractMemoryInput {
                source_conversation_id: ConversationId::new("c-ext-1").unwrap(),
                kind: "fact".to_string(),
                content: "remember this".to_string(),
            })
            .unwrap();
        assert!(result.skipped_by_feature_flag);
        assert!(result.saved_memory_id.is_none());
        assert!(store.saved.lock().unwrap().is_empty());
    }

    #[test]
    fn extraction_saves_when_feature_flag_enabled() {
        let store = FakeStore {
            saved: Mutex::new(Vec::new()),
        };
        let flag = FakeFlag { enabled: true };
        let use_case = ExtractMemoryUseCase {
            memory_store: &store,
            extraction_flag: &flag,
        };
        let result = use_case
            .execute(ExtractMemoryInput {
                source_conversation_id: ConversationId::new("c-ext-2").unwrap(),
                kind: " preference ".to_string(),
                content: " likes local models ".to_string(),
            })
            .unwrap();
        assert!(!result.skipped_by_feature_flag);
        assert_eq!(result.saved_memory_id.as_deref(), Some("mem-1"));
        let saved = store.saved.lock().unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].kind, "preference");
        assert_eq!(saved[0].content, "likes local models");
    }
}
