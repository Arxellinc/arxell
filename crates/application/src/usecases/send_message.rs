use arx_domain::{
    AppEvent, ChatMessage, ChatProvider, ConversationId, CorrelationId, DomainError, MessageId,
    MessageRole, ProviderRequest, ProviderResponse, RunId, TokenSink,
};

use crate::ports::{EventPublisher, MessageStore, RunStore};

pub struct SendMessageInput {
    pub correlation_id: CorrelationId,
    pub run_id: RunId,
    pub conversation_id: ConversationId,
    pub user_message_id: MessageId,
    pub assistant_message_id: MessageId,
    pub model: String,
    pub user_content: String,
    pub system_prompt: Option<String>,
}

pub struct SendMessageResult {
    pub assistant_content: String,
}

pub struct SendMessageUseCase<'a> {
    pub message_store: &'a dyn MessageStore,
    pub run_store: &'a dyn RunStore,
    pub event_publisher: &'a dyn EventPublisher,
    pub provider: &'a dyn ChatProvider,
}

struct StreamingSink<'a> {
    correlation_id: CorrelationId,
    run_id: RunId,
    event_publisher: &'a dyn EventPublisher,
    output: String,
}

impl<'a> TokenSink for StreamingSink<'a> {
    fn on_token(&mut self, delta: &str) -> Result<(), DomainError> {
        self.output.push_str(delta);
        self.event_publisher.publish(AppEvent::TokenReceived {
            correlation_id: self.correlation_id.clone(),
            run_id: self.run_id.clone(),
            delta: delta.to_string(),
        })
    }
}

impl<'a> SendMessageUseCase<'a> {
    pub fn execute(&self, input: SendMessageInput) -> Result<SendMessageResult, DomainError> {
        if input.model.trim().is_empty() {
            return Err(DomainError::validation("model", "must not be empty"));
        }

        self.run_store
            .start_run(input.run_id.clone(), input.correlation_id.clone())?;

        self.event_publisher.publish(AppEvent::ChatStarted {
            correlation_id: input.correlation_id.clone(),
            run_id: input.run_id.clone(),
            assistant_message_id: input.assistant_message_id.clone(),
        })?;

        let user_message = ChatMessage::new(
            input.user_message_id,
            input.conversation_id.clone(),
            MessageRole::User,
            input.user_content,
        )?;
        self.message_store.append_message(user_message)?;

        let history = self.message_store.list_messages(&input.conversation_id)?;

        let mut sink = StreamingSink {
            correlation_id: input.correlation_id,
            run_id: input.run_id,
            event_publisher: self.event_publisher,
            output: String::new(),
        };

        let provider_response = self.provider.stream_chat(
            ProviderRequest {
                model: input.model,
                messages: history,
                system_prompt: input.system_prompt,
            },
            &mut sink,
        )?;

        let final_content = merge_content(provider_response, &sink.output);

        let assistant_message = ChatMessage::new(
            input.assistant_message_id,
            input.conversation_id,
            MessageRole::Assistant,
            final_content.clone(),
        )?;
        self.message_store.append_message(assistant_message)?;

        Ok(SendMessageResult {
            assistant_content: final_content,
        })
    }
}

fn merge_content(response: ProviderResponse, streamed: &str) -> String {
    if response.content.trim().is_empty() {
        streamed.to_string()
    } else {
        response.content
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    struct FakeMessageStore {
        messages: Mutex<Vec<ChatMessage>>,
    }

    impl FakeMessageStore {
        fn new() -> Self {
            Self {
                messages: Mutex::new(Vec::new()),
            }
        }
    }

    impl MessageStore for FakeMessageStore {
        fn append_message(&self, message: ChatMessage) -> Result<(), DomainError> {
            let mut guard = self.messages.lock().map_err(|_| DomainError::Internal {
                reason: "message lock poisoned".to_string(),
            })?;
            guard.push(message);
            Ok(())
        }

        fn list_messages(
            &self,
            conversation_id: &ConversationId,
        ) -> Result<Vec<ChatMessage>, DomainError> {
            let guard = self.messages.lock().map_err(|_| DomainError::Internal {
                reason: "message lock poisoned".to_string(),
            })?;
            Ok(guard
                .iter()
                .filter(|m| &m.conversation_id == conversation_id)
                .cloned()
                .collect())
        }
    }

    struct FakeRunStore {
        started: Mutex<Vec<(RunId, CorrelationId)>>,
    }

    impl FakeRunStore {
        fn new() -> Self {
            Self {
                started: Mutex::new(Vec::new()),
            }
        }
    }

    impl RunStore for FakeRunStore {
        fn start_run(
            &self,
            run_id: RunId,
            correlation_id: CorrelationId,
        ) -> Result<(), DomainError> {
            let mut guard = self.started.lock().map_err(|_| DomainError::Internal {
                reason: "run lock poisoned".to_string(),
            })?;
            guard.push((run_id, correlation_id));
            Ok(())
        }

        fn cancel_run(&self, _run_id: &RunId) -> Result<bool, DomainError> {
            Ok(false)
        }
    }

    struct FakeEventPublisher {
        events: Mutex<Vec<AppEvent>>,
    }

    impl FakeEventPublisher {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }
    }

    impl EventPublisher for FakeEventPublisher {
        fn publish(&self, event: AppEvent) -> Result<(), DomainError> {
            let mut guard = self.events.lock().map_err(|_| DomainError::Internal {
                reason: "event lock poisoned".to_string(),
            })?;
            guard.push(event);
            Ok(())
        }
    }

    struct FakeProvider {
        deltas: Vec<String>,
        response: String,
    }

    impl ChatProvider for FakeProvider {
        fn stream_chat(
            &self,
            _request: ProviderRequest,
            sink: &mut dyn TokenSink,
        ) -> Result<ProviderResponse, DomainError> {
            for delta in &self.deltas {
                sink.on_token(delta)?;
            }
            Ok(ProviderResponse {
                content: self.response.clone(),
            })
        }
    }

    #[test]
    fn send_message_persists_and_streams() {
        let message_store = FakeMessageStore::new();
        let run_store = FakeRunStore::new();
        let event_publisher = FakeEventPublisher::new();
        let provider = FakeProvider {
            deltas: vec!["hel".to_string(), "lo".to_string()],
            response: "hello".to_string(),
        };

        let use_case = SendMessageUseCase {
            message_store: &message_store,
            run_store: &run_store,
            event_publisher: &event_publisher,
            provider: &provider,
        };

        let input = SendMessageInput {
            correlation_id: CorrelationId::new("corr-1").unwrap(),
            run_id: RunId::new("run-1").unwrap(),
            conversation_id: ConversationId::new("c-1").unwrap(),
            user_message_id: MessageId::new("m-user").unwrap(),
            assistant_message_id: MessageId::new("m-assistant").unwrap(),
            model: "gpt-x".to_string(),
            user_content: "hi".to_string(),
            system_prompt: None,
        };

        let result = use_case.execute(input).unwrap();
        assert_eq!(result.assistant_content, "hello");

        let stored = message_store.messages.lock().unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].role, MessageRole::User);
        assert_eq!(stored[1].role, MessageRole::Assistant);

        let events = event_publisher.events.lock().unwrap();
        assert!(events
            .iter()
            .any(|e| matches!(e, AppEvent::ChatStarted { .. })));
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, AppEvent::TokenReceived { .. }))
                .count(),
            2
        );
    }
}
