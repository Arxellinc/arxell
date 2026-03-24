use std::sync::Mutex;

use arx_domain::{
    AppEvent, ChatMessage, ChatProvider, ConversationId, CorrelationId, DomainError, MessageId,
    MessageRole, ProviderRequest, ProviderResponse, RunId, TokenSink,
};

use crate::{
    CancelRunInput, CancelRunUseCase, EventPublisher, MessageStore, RunStore, SendMessageInput,
    SendMessageUseCase,
};

struct TestMessageStore {
    messages: Mutex<Vec<ChatMessage>>,
}

impl TestMessageStore {
    fn new() -> Self {
        Self {
            messages: Mutex::new(Vec::new()),
        }
    }
}

impl MessageStore for TestMessageStore {
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
            .filter(|message| &message.conversation_id == conversation_id)
            .cloned()
            .collect())
    }
}

struct TestRunStore {
    started: Mutex<Vec<(RunId, CorrelationId)>>,
    cancelled: Mutex<Vec<RunId>>,
}

impl TestRunStore {
    fn new() -> Self {
        Self {
            started: Mutex::new(Vec::new()),
            cancelled: Mutex::new(Vec::new()),
        }
    }
}

impl RunStore for TestRunStore {
    fn start_run(&self, run_id: RunId, correlation_id: CorrelationId) -> Result<(), DomainError> {
        let mut guard = self.started.lock().map_err(|_| DomainError::Internal {
            reason: "run lock poisoned".to_string(),
        })?;
        guard.push((run_id, correlation_id));
        Ok(())
    }

    fn cancel_run(&self, run_id: &RunId) -> Result<bool, DomainError> {
        let mut guard = self.cancelled.lock().map_err(|_| DomainError::Internal {
            reason: "run lock poisoned".to_string(),
        })?;
        guard.push(run_id.clone());
        Ok(true)
    }
}

struct TestEventPublisher {
    events: Mutex<Vec<AppEvent>>,
}

impl TestEventPublisher {
    fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
        }
    }
}

impl EventPublisher for TestEventPublisher {
    fn publish(&self, event: AppEvent) -> Result<(), DomainError> {
        let mut guard = self.events.lock().map_err(|_| DomainError::Internal {
            reason: "event lock poisoned".to_string(),
        })?;
        guard.push(event);
        Ok(())
    }
}

struct TestProvider;

impl ChatProvider for TestProvider {
    fn stream_chat(
        &self,
        _request: ProviderRequest,
        sink: &mut dyn TokenSink,
    ) -> Result<ProviderResponse, DomainError> {
        sink.on_token("hello ")?;
        sink.on_token("world")?;
        Ok(ProviderResponse {
            content: "hello world".to_string(),
        })
    }
}

#[test]
fn contract_chat_slice_send_then_cancel_preserves_run_and_message_behavior() {
    let message_store = TestMessageStore::new();
    let run_store = TestRunStore::new();
    let event_publisher = TestEventPublisher::new();
    let provider = TestProvider;

    let send = SendMessageUseCase {
        message_store: &message_store,
        run_store: &run_store,
        event_publisher: &event_publisher,
        provider: &provider,
    };

    let run_id = RunId::new("run-slice-1").unwrap();
    let result = send
        .execute(SendMessageInput {
            correlation_id: CorrelationId::new("corr-slice-1").unwrap(),
            run_id: run_id.clone(),
            conversation_id: ConversationId::new("conv-slice-1").unwrap(),
            user_message_id: MessageId::new("msg-user-slice-1").unwrap(),
            assistant_message_id: MessageId::new("msg-assistant-slice-1").unwrap(),
            model: "gpt-x".to_string(),
            user_content: "hi".to_string(),
            system_prompt: None,
        })
        .unwrap();

    assert_eq!(result.assistant_content, "hello world");

    let cancel = CancelRunUseCase {
        run_store: &run_store,
    };
    let cancel_result = cancel
        .execute(CancelRunInput {
            run_id: run_id.clone(),
        })
        .unwrap();

    assert!(cancel_result.cancelled);

    let started = run_store.started.lock().unwrap();
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].0, run_id);

    let cancelled = run_store.cancelled.lock().unwrap();
    assert_eq!(cancelled.len(), 1);
    assert_eq!(cancelled[0], started[0].0);

    let stored_messages = message_store.messages.lock().unwrap();
    assert_eq!(stored_messages.len(), 2);
    assert_eq!(stored_messages[0].role, MessageRole::User);
    assert_eq!(stored_messages[1].role, MessageRole::Assistant);

    let events = event_publisher.events.lock().unwrap();
    let chat_started_index = events
        .iter()
        .position(|event| matches!(event, AppEvent::ChatStarted { .. }))
        .expect("chat started event must exist");
    let first_token_index = events
        .iter()
        .position(|event| matches!(event, AppEvent::TokenReceived { .. }))
        .expect("token events must exist");
    assert!(chat_started_index < first_token_index);
}
