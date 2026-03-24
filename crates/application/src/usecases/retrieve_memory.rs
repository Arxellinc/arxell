use arx_domain::{ConversationId, DomainError, MemoryItem, MemoryRetriever};

pub struct RetrieveMemoryInput {
    pub conversation_id: ConversationId,
    pub query: String,
    pub limit: usize,
}

#[derive(Debug)]
pub struct RetrieveMemoryResult {
    pub items: Vec<MemoryItem>,
}

pub struct RetrieveMemoryUseCase<'a> {
    pub retriever: &'a dyn MemoryRetriever,
}

impl<'a> RetrieveMemoryUseCase<'a> {
    pub fn execute(&self, input: RetrieveMemoryInput) -> Result<RetrieveMemoryResult, DomainError> {
        let query = input.query.trim().to_string();
        if query.is_empty() {
            return Err(DomainError::validation("query", "must not be empty"));
        }
        if input.limit == 0 {
            return Err(DomainError::validation("limit", "must be greater than zero"));
        }
        let items = self
            .retriever
            .retrieve(&input.conversation_id, &query, input.limit)?;
        Ok(RetrieveMemoryResult { items })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use arx_domain::{ConversationId, DomainError, MemoryItem, MemoryRetriever};

    use super::{RetrieveMemoryInput, RetrieveMemoryUseCase};

    struct FakeRetriever {
        calls: Mutex<Vec<(String, String, usize)>>,
        items: Vec<MemoryItem>,
    }

    impl MemoryRetriever for FakeRetriever {
        fn retrieve(
            &self,
            conversation_id: &ConversationId,
            query: &str,
            limit: usize,
        ) -> Result<Vec<MemoryItem>, DomainError> {
            let mut calls = self.calls.lock().map_err(|_| DomainError::Internal {
                reason: "calls lock poisoned".to_string(),
            })?;
            calls.push((
                conversation_id.as_str().to_string(),
                query.to_string(),
                limit,
            ));
            Ok(self.items.clone())
        }
    }

    #[test]
    fn contract_retrieve_memory_is_read_only_and_validates_input() {
        let retriever = FakeRetriever {
            calls: Mutex::new(Vec::new()),
            items: vec![MemoryItem {
                id: "m1".to_string(),
                kind: "fact".to_string(),
                content: "user likes rust".to_string(),
                confidence_basis_points: 9100,
            }],
        };
        let use_case = RetrieveMemoryUseCase {
            retriever: &retriever,
        };
        let result = use_case
            .execute(RetrieveMemoryInput {
                conversation_id: ConversationId::new("c-memory-1").unwrap(),
                query: " rust ".to_string(),
                limit: 3,
            })
            .unwrap();
        assert_eq!(result.items.len(), 1);

        let calls = retriever.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "c-memory-1");
        assert_eq!(calls[0].1, "rust");
        assert_eq!(calls[0].2, 3);
    }

    #[test]
    fn retrieve_memory_rejects_empty_query() {
        let retriever = FakeRetriever {
            calls: Mutex::new(Vec::new()),
            items: vec![],
        };
        let use_case = RetrieveMemoryUseCase {
            retriever: &retriever,
        };
        let err = use_case
            .execute(RetrieveMemoryInput {
                conversation_id: ConversationId::new("c-memory-2").unwrap(),
                query: "   ".to_string(),
                limit: 1,
            })
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { field, .. } if field == "query"));
    }
}
