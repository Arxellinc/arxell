use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use arx_application::{
    CancelRunInput, CancelRunUseCase, EventPublisher, MessageStore, RunStore, SendMessageInput,
    SendMessageUseCase,
};
use arx_domain::{
    AppEvent, ChatMessage, ChatProvider, ConversationId, CorrelationId, DomainError, MessageId,
    MessageRole, ProviderRequest, ProviderResponse, RunId, TokenSink,
};
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::models::Message;
use crate::model_manager::ModelManagerState;
use crate::AppState;

use super::chat;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageCommand {
    pub correlation_id: String,
    pub conversation_id: String,
    pub content: String,
    pub extra_context: Option<String>,
    pub thinking_enabled: Option<bool>,
    pub assistant_msg_id: Option<String>,
    pub screenshot_base64: Option<String>,
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageResult {
    pub user_message: Message,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRunCommand {
    pub correlation_id: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCommand {
    pub correlation_id: String,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMessagesResult {
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateLastPromptResult {
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeEvent {
    CommandAccepted {
        correlation_id: String,
        command: String,
    },
    CommandFailed {
        correlation_id: String,
        command: String,
        message: String,
    },
}

fn emit_bridge_event(app: &AppHandle, event: BridgeEvent) {
    let _ = app.emit("bridge:event", event);
}

fn complete_bridge_command<T, F, E>(
    correlation_id: String,
    command: &str,
    run: F,
    mut emit: E,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
    E: FnMut(BridgeEvent),
{
    match run() {
        Ok(ok) => {
            emit(BridgeEvent::CommandAccepted {
                correlation_id,
                command: command.to_string(),
            });
            Ok(ok)
        }
        Err(message) => {
            emit(BridgeEvent::CommandFailed {
                correlation_id,
                command: command.to_string(),
                message: message.clone(),
            });
            Err(message)
        }
    }
}

async fn complete_bridge_command_async<T, Fut, F, E>(
    correlation_id: String,
    command: &str,
    run: F,
    mut emit: E,
) -> Result<T, String>
where
    Fut: std::future::Future<Output = Result<T, String>>,
    F: FnOnce() -> Fut,
    E: FnMut(BridgeEvent),
{
    match run().await {
        Ok(ok) => {
            emit(BridgeEvent::CommandAccepted {
                correlation_id,
                command: command.to_string(),
            });
            Ok(ok)
        }
        Err(message) => {
            emit(BridgeEvent::CommandFailed {
                correlation_id,
                command: command.to_string(),
                message: message.clone(),
            });
            Err(message)
        }
    }
}

fn truthy_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn resolve_bridge_application_enabled(env_value: Option<&str>, db_value: Option<&str>) -> bool {
    env_value.map(truthy_flag).unwrap_or(false) || db_value.map(truthy_flag).unwrap_or(false)
}

fn bridge_application_enabled(state: &AppState) -> bool {
    let env_value = std::env::var("ARX_BRIDGE_APPLICATION_ENABLED").ok();

    if let Ok(db) = state.db.lock() {
        let setting: Result<Option<String>, rusqlite::Error> = db
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params!["bridge_application_enabled"],
                |row| row.get::<_, String>(0),
            )
            .optional();

        if let Ok(Some(value)) = setting {
            return resolve_bridge_application_enabled(env_value.as_deref(), Some(&value));
        }
    }

    resolve_bridge_application_enabled(env_value.as_deref(), None)
}

fn get_setting(state: &AppState, key: &str, default: &str) -> String {
    if let Ok(db) = state.db.lock() {
        let result: Result<String, rusqlite::Error> = db.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get::<_, String>(0),
        );
        if let Ok(value) = result {
            return value;
        }
    }
    default.to_string()
}

fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let has_version_suffix = base
        .rsplit('/')
        .next()
        .map(|seg| {
            seg.len() > 1
                && seg.as_bytes()[0].eq_ignore_ascii_case(&b'v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false);

    if has_version_suffix {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

fn role_to_string(role: MessageRole) -> &'static str {
    match role {
        MessageRole::System => "system",
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::Tool => "tool",
    }
}

fn domain_error(reason: impl Into<String>) -> DomainError {
    DomainError::Internal {
        reason: reason.into(),
    }
}

struct SqliteMessageStore<'a> {
    state: &'a AppState,
}

impl<'a> MessageStore for SqliteMessageStore<'a> {
    fn append_message(&self, message: ChatMessage) -> Result<(), DomainError> {
        let db = self
            .state
            .db
            .lock()
            .map_err(|_| domain_error("db lock poisoned"))?;

        let created_at = Utc::now().timestamp_millis();
        db.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                message.id.as_str(),
                message.conversation_id.as_str(),
                role_to_string(message.role),
                message.content,
                created_at
            ],
        )
        .map_err(|e| domain_error(e.to_string()))?;

        db.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![created_at, message.conversation_id.as_str()],
        )
        .map_err(|e| domain_error(e.to_string()))?;

        Ok(())
    }

    fn list_messages(
        &self,
        conversation_id: &ConversationId,
    ) -> Result<Vec<ChatMessage>, DomainError> {
        let db = self
            .state
            .db
            .lock()
            .map_err(|_| domain_error("db lock poisoned"))?;

        let mut stmt = db
            .prepare(
                "SELECT id, role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| domain_error(e.to_string()))?;

        let rows = stmt
            .query_map(rusqlite::params![conversation_id.as_str()], |row| {
                let id: String = row.get(0)?;
                let role: String = row.get(1)?;
                let content: String = row.get(2)?;
                Ok((id, role, content))
            })
            .map_err(|e| domain_error(e.to_string()))?;

        let mut out = Vec::new();
        for row in rows {
            let (id, role, content) = row.map_err(|e| domain_error(e.to_string()))?;
            let message_id = MessageId::new(id).map_err(|e| domain_error(e.to_string()))?;
            let domain_role = match role.to_ascii_lowercase().as_str() {
                "system" => MessageRole::System,
                "assistant" => MessageRole::Assistant,
                "tool" => MessageRole::Tool,
                _ => MessageRole::User,
            };
            let message = ChatMessage::new(
                message_id,
                ConversationId::new(conversation_id.as_str().to_string())
                    .map_err(|e| domain_error(e.to_string()))?,
                domain_role,
                content,
            )
            .map_err(|e| domain_error(e.to_string()))?;
            out.push(message);
        }

        Ok(out)
    }
}

struct BridgeRunStore<'a> {
    state: &'a AppState,
}

impl<'a> RunStore for BridgeRunStore<'a> {
    fn start_run(&self, _run_id: RunId, _correlation_id: CorrelationId) -> Result<(), DomainError> {
        Ok(())
    }

    fn cancel_run(&self, _run_id: &RunId) -> Result<bool, DomainError> {
        self.state
            .chat_cancel
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    }
}

#[derive(Clone)]
struct BridgeEventPublisher {
    app: Option<AppHandle>,
    run_to_assistant_message: Arc<Mutex<HashMap<String, String>>>,
}

impl EventPublisher for BridgeEventPublisher {
    fn publish(&self, event: AppEvent) -> Result<(), DomainError> {
        match event {
            AppEvent::ChatStarted {
                run_id,
                assistant_message_id,
                ..
            } => {
                let mut guard = self
                    .run_to_assistant_message
                    .lock()
                    .map_err(|_| domain_error("event map lock poisoned"))?;
                guard.insert(
                    run_id.as_str().to_string(),
                    assistant_message_id.as_str().to_string(),
                );
            }
            AppEvent::TokenReceived { run_id, delta, .. } => {
                let id = {
                    let guard = self
                        .run_to_assistant_message
                        .lock()
                        .map_err(|_| domain_error("event map lock poisoned"))?;
                    guard.get(run_id.as_str()).cloned()
                };
                if let Some(message_id) = id {
                    if let Some(app) = &self.app {
                        let _ = app.emit(
                            "chat:chunk",
                            serde_json::json!({
                                "id": message_id,
                                "delta": delta,
                                "done": false
                            }),
                        );
                    }
                }
            }
            _ => {}
        }

        Ok(())
    }
}

#[derive(Clone)]
struct OpenAiCompatibleProviderAdapter {
    handle: tokio::runtime::Handle,
    client: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl ChatProvider for OpenAiCompatibleProviderAdapter {
    fn stream_chat(
        &self,
        request: ProviderRequest,
        sink: &mut dyn TokenSink,
    ) -> Result<ProviderResponse, DomainError> {
        let handle = self.handle.clone();
        let client = self.client.clone();
        let url = chat_completions_url(&self.base_url);
        let api_key = self.api_key.clone();

        let mut messages = Vec::new();
        if let Some(system_prompt) = request.system_prompt {
            if !system_prompt.trim().is_empty() {
                messages.push(serde_json::json!({
                    "role": "system",
                    "content": system_prompt,
                }));
            }
        }
        for message in request.messages {
            messages.push(serde_json::json!({
                "role": role_to_string(message.role),
                "content": message.content,
            }));
        }

        let response_text = tokio::task::block_in_place(|| {
            handle.block_on(async move {
                let mut req = client.post(url).header("Content-Type", "application/json");
                if !api_key.trim().is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", api_key));
                }

                let response = req
                    .json(&serde_json::json!({
                        "model": request.model,
                        "messages": messages,
                        "stream": false,
                    }))
                    .send()
                    .await
                    .map_err(|e| domain_error(e.to_string()))?;

                if !response.status().is_success() {
                    let status = response.status();
                    let body = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<unreadable response body>".to_string());
                    return Err(domain_error(format!("provider returned {status}: {body}")));
                }

                let body: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|e| domain_error(e.to_string()))?;

                let text = body
                    .get("choices")
                    .and_then(|v| v.get(0))
                    .and_then(|v| v.get("message"))
                    .and_then(|v| v.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok(text)
            })
        })?;

        sink.on_token(&response_text)?;
        Ok(ProviderResponse {
            content: response_text,
        })
    }
}

fn run_send_message_use_case(
    app: Option<&AppHandle>,
    state: &AppState,
    payload: &SendMessageCommand,
) -> Result<SendMessageResult, String> {
    let base_url = get_setting(state, "base_url", "http://localhost:11434/v1");
    let api_key = get_setting(state, "api_key", "ollama");
    let model = get_setting(state, "model", "llama3.2");
    let base_system_prompt = get_setting(state, "system_prompt", "");
    let system_prompt = match payload.extra_context.clone() {
        Some(ctx) if !ctx.is_empty() => {
            if base_system_prompt.is_empty() {
                Some(ctx)
            } else {
                Some(format!("{}\n\n{}", base_system_prompt, ctx))
            }
        }
        _ => {
            if base_system_prompt.is_empty() {
                None
            } else {
                Some(base_system_prompt)
            }
        }
    };

    let provider = OpenAiCompatibleProviderAdapter {
        handle: tokio::runtime::Handle::current(),
        client: state.http_client.clone(),
        base_url,
        api_key,
    };

    run_send_message_use_case_with_provider(app, state, payload, &provider, model, system_prompt)
}

fn run_send_message_use_case_with_provider(
    app: Option<&AppHandle>,
    state: &AppState,
    payload: &SendMessageCommand,
    provider: &dyn ChatProvider,
    model: String,
    system_prompt: Option<String>,
) -> Result<SendMessageResult, String> {
    let correlation_id =
        CorrelationId::new(payload.correlation_id.clone()).map_err(|e| e.to_string())?;
    let conversation_id =
        ConversationId::new(payload.conversation_id.clone()).map_err(|e| e.to_string())?;

    let user_message_id = MessageId::new(Uuid::new_v4().to_string()).map_err(|e| e.to_string())?;
    let assistant_message_id = MessageId::new(
        payload
            .assistant_msg_id
            .clone()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
    )
    .map_err(|e| e.to_string())?;
    let run_id = RunId::new(Uuid::new_v4().to_string()).map_err(|e| e.to_string())?;

    let user_message_id_raw = user_message_id.as_str().to_string();
    let assistant_message_id_raw = assistant_message_id.as_str().to_string();
    let conversation_id_raw = conversation_id.as_str().to_string();
    let message_store = SqliteMessageStore { state };
    let run_store = BridgeRunStore { state };
    let event_publisher = BridgeEventPublisher {
        app: app.cloned(),
        run_to_assistant_message: Arc::new(Mutex::new(HashMap::new())),
    };

    let use_case = SendMessageUseCase {
        message_store: &message_store,
        run_store: &run_store,
        event_publisher: &event_publisher,
        provider,
    };

    let use_case_result = use_case.execute(SendMessageInput {
        correlation_id,
        run_id,
        conversation_id,
        user_message_id,
        assistant_message_id,
        model,
        user_content: payload.content.clone(),
        system_prompt,
    });

    match use_case_result {
        Ok(_) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "chat:chunk",
                    serde_json::json!({
                        "id": assistant_message_id_raw,
                        "delta": "",
                        "done": true,
                    }),
                );
            }
            Ok(SendMessageResult {
                user_message: Message {
                    id: user_message_id_raw,
                    conversation_id: conversation_id_raw,
                    role: "user".to_string(),
                    content: payload.content.clone(),
                    created_at: Utc::now().timestamp_millis(),
                },
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

fn run_cancel_use_case(state: &AppState, payload: &CancelRunCommand) -> Result<(), String> {
    let run_store = BridgeRunStore { state };
    let use_case = CancelRunUseCase {
        run_store: &run_store,
    };

    let run_id = RunId::new(
        payload
            .run_id
            .clone()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "active-run".to_string()),
    )
    .map_err(|e| e.to_string())?;

    use_case
        .execute(CancelRunInput { run_id })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_bridge_send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    model_state: State<'_, ModelManagerState>,
    payload: SendMessageCommand,
) -> Result<SendMessageResult, String> {
    let correlation_id = payload.correlation_id.clone();
    complete_bridge_command_async(
        correlation_id,
        "send_message",
        || async {
            if bridge_application_enabled(&state) {
                run_send_message_use_case(Some(&app), &state, &payload)
            } else {
                chat::cmd_chat_stream(
                    app.clone(),
                    state,
                    model_state,
                    payload.conversation_id.clone(),
                    payload.content.clone(),
                    payload.extra_context.clone(),
                    payload.thinking_enabled,
                    payload.assistant_msg_id.clone(),
                    payload.screenshot_base64.clone(),
                    payload.mode_id,
                )
                .await
                .map(|user_message| SendMessageResult { user_message })
            }
        },
        |event| emit_bridge_event(&app, event),
    )
    .await
}

#[tauri::command]
pub fn cmd_bridge_cancel_run(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CancelRunCommand,
) -> Result<(), String> {
    let correlation_id = payload.correlation_id.clone();
    complete_bridge_command(
        correlation_id,
        "cancel_run",
        || {
            if bridge_application_enabled(&state) {
                run_cancel_use_case(&state, &payload)
            } else {
                chat::cmd_chat_cancel(state)
            }
        },
        |event| emit_bridge_event(&app, event),
    )
}

#[tauri::command]
pub fn cmd_bridge_get_messages(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ConversationCommand,
) -> Result<GetMessagesResult, String> {
    let result = chat::cmd_chat_get_messages(state, payload.conversation_id);
    match result {
        Ok(messages) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandAccepted {
                    correlation_id: payload.correlation_id,
                    command: "get_messages".to_string(),
                },
            );
            Ok(GetMessagesResult { messages })
        }
        Err(message) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandFailed {
                    correlation_id: payload.correlation_id,
                    command: "get_messages".to_string(),
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn cmd_bridge_clear_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ConversationCommand,
) -> Result<(), String> {
    let result = chat::cmd_chat_clear(state, payload.conversation_id);
    match result {
        Ok(()) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandAccepted {
                    correlation_id: payload.correlation_id,
                    command: "clear_conversation".to_string(),
                },
            );
            Ok(())
        }
        Err(message) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandFailed {
                    correlation_id: payload.correlation_id,
                    command: "clear_conversation".to_string(),
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn cmd_bridge_regenerate_last_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ConversationCommand,
) -> Result<RegenerateLastPromptResult, String> {
    let result = chat::cmd_chat_regenerate_last_prompt(state, payload.conversation_id);
    match result {
        Ok(prompt) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandAccepted {
                    correlation_id: payload.correlation_id,
                    command: "regenerate_last_prompt".to_string(),
                },
            );
            Ok(RegenerateLastPromptResult { prompt })
        }
        Err(message) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandFailed {
                    correlation_id: payload.correlation_id,
                    command: "regenerate_last_prompt".to_string(),
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    use crate::AppState;

    struct FakeProvider;

    impl ChatProvider for FakeProvider {
        fn stream_chat(
            &self,
            _request: ProviderRequest,
            sink: &mut dyn TokenSink,
        ) -> Result<ProviderResponse, DomainError> {
            sink.on_token("bridge hello")?;
            Ok(ProviderResponse {
                content: "bridge hello".to_string(),
            })
        }
    }

    fn build_test_state(db: rusqlite::Connection, a2a_db: rusqlite::Connection) -> AppState {
        AppState {
            db: Mutex::new(db),
            a2a_db: Mutex::new(a2a_db),
            voice_active: Mutex::new(false),
            audio_buffer: Mutex::new(Vec::new()),
            chat_cancel: Arc::new(AtomicBool::new(false)),
            speculative_cancel: Arc::new(AtomicBool::new(false)),
            generation_id: Arc::new(AtomicU64::new(0)),
            voice_running: Arc::new(AtomicBool::new(false)),
            local_server: Mutex::new(None),
            kokoro_daemon: Arc::new(Mutex::new(None)),
            whisper_daemon: Arc::new(Mutex::new(None)),
            whisper_rs_ctx: Arc::new(Mutex::new(None)),
            http_client: reqwest::Client::new(),
            memory_dir: std::env::temp_dir(),
        }
    }

    fn init_bridge_test_db() -> rusqlite::Connection {
        let db = rusqlite::Connection::open_in_memory().expect("open in-memory db");
        db.execute_batch(
            r#"
            PRAGMA foreign_keys=ON;
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                title TEXT NOT NULL DEFAULT 'New Chat',
                model TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            INSERT INTO settings (key, value) VALUES
                ('base_url', 'http://127.0.0.1:11434/v1'),
                ('api_key', ''),
                ('model', 'gpt-x'),
                ('system_prompt', '');
            "#,
        )
        .expect("init bridge test schema");
        db
    }

    #[test]
    fn bridge_event_command_accepted_serializes_contract_shape() {
        let event = BridgeEvent::CommandAccepted {
            correlation_id: "corr-123".to_string(),
            command: "send_message".to_string(),
        };

        let value = serde_json::to_value(event).expect("serialize bridge event");
        assert_eq!(
            value,
            json!({
                "type": "command_accepted",
                "correlation_id": "corr-123",
                "command": "send_message"
            })
        );
    }

    #[test]
    fn bridge_event_command_failed_serializes_contract_shape() {
        let event = BridgeEvent::CommandFailed {
            correlation_id: "corr-789".to_string(),
            command: "cancel_run".to_string(),
            message: "run not found".to_string(),
        };

        let value = serde_json::to_value(event).expect("serialize bridge event");
        assert_eq!(
            value,
            json!({
                "type": "command_failed",
                "correlation_id": "corr-789",
                "command": "cancel_run",
                "message": "run not found"
            })
        );
    }

    #[test]
    fn send_message_result_serializes_camel_case_user_message() {
        let result = SendMessageResult {
            user_message: Message {
                id: "m-1".to_string(),
                conversation_id: "c-1".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
                created_at: 1_700_000_000_000,
            },
        };

        let value = serde_json::to_value(result).expect("serialize send result");
        assert_eq!(
            value,
            json!({
                "userMessage": {
                    "id": "m-1",
                    "conversation_id": "c-1",
                    "role": "user",
                    "content": "hello",
                    "created_at": 1700000000000_i64
                }
            })
        );
    }

    #[test]
    fn get_messages_result_serializes_camel_case_messages() {
        let result = GetMessagesResult {
            messages: vec![Message {
                id: "m-2".to_string(),
                conversation_id: "c-2".to_string(),
                role: "assistant".to_string(),
                content: "hi".to_string(),
                created_at: 1_700_000_000_001,
            }],
        };

        let value = serde_json::to_value(result).expect("serialize get messages result");
        assert_eq!(
            value,
            json!({
                "messages": [{
                    "id": "m-2",
                    "conversation_id": "c-2",
                    "role": "assistant",
                    "content": "hi",
                    "created_at": 1700000000001_i64
                }]
            })
        );
    }

    #[test]
    fn regenerate_last_prompt_result_serializes_camel_case_prompt() {
        let result = RegenerateLastPromptResult {
            prompt: "what is next?".to_string(),
        };

        let value = serde_json::to_value(result).expect("serialize regenerate result");
        assert_eq!(
            value,
            json!({
                "prompt": "what is next?"
            })
        );
    }

    #[test]
    fn bridge_flag_contract_env_true_enables_application_path() {
        assert!(resolve_bridge_application_enabled(Some("true"), None));
        assert!(resolve_bridge_application_enabled(Some("1"), None));
        assert!(resolve_bridge_application_enabled(Some("on"), None));
        assert!(resolve_bridge_application_enabled(Some("yes"), None));
    }

    #[test]
    fn bridge_flag_contract_db_true_enables_application_path() {
        assert!(resolve_bridge_application_enabled(None, Some("true")));
        assert!(resolve_bridge_application_enabled(None, Some("1")));
        assert!(resolve_bridge_application_enabled(None, Some("on")));
        assert!(resolve_bridge_application_enabled(None, Some("yes")));
    }

    #[test]
    fn bridge_flag_contract_false_when_both_sources_false() {
        assert!(!resolve_bridge_application_enabled(None, None));
        assert!(!resolve_bridge_application_enabled(Some("false"), None));
        assert!(!resolve_bridge_application_enabled(None, Some("false")));
        assert!(!resolve_bridge_application_enabled(Some("0"), Some("off")));
    }

    #[test]
    fn bridge_flag_contract_env_takes_no_special_precedence_over_true_db() {
        assert!(resolve_bridge_application_enabled(
            Some("false"),
            Some("true")
        ));
        assert!(resolve_bridge_application_enabled(Some("0"), Some("on")));
    }

    #[test]
    fn bridge_command_contract_success_emits_after_run() {
        let timeline = Rc::new(RefCell::new(Vec::<String>::new()));
        let timeline_in_run = timeline.clone();
        let timeline_in_emit = timeline.clone();

        let result: Result<i32, String> = complete_bridge_command(
            "corr-success-1".to_string(),
            "cancel_run",
            move || {
                timeline_in_run.borrow_mut().push("run".to_string());
                Ok(7)
            },
            move |event| {
                timeline_in_emit.borrow_mut().push("emit".to_string());
                assert!(matches!(
                    event,
                    BridgeEvent::CommandAccepted {
                        correlation_id,
                        command
                    } if correlation_id == "corr-success-1" && command == "cancel_run"
                ));
            },
        );

        assert_eq!(result, Ok(7));
        assert_eq!(timeline.borrow().as_slice(), ["run", "emit"]);
    }

    #[test]
    fn bridge_command_contract_failure_emits_after_run_with_error_message() {
        let timeline = Rc::new(RefCell::new(Vec::<String>::new()));
        let timeline_in_run = timeline.clone();
        let timeline_in_emit = timeline.clone();

        let result: Result<(), String> = complete_bridge_command(
            "corr-fail-1".to_string(),
            "send_message",
            move || {
                timeline_in_run.borrow_mut().push("run".to_string());
                Err("boom".to_string())
            },
            move |event| {
                timeline_in_emit.borrow_mut().push("emit".to_string());
                assert!(matches!(
                    event,
                    BridgeEvent::CommandFailed {
                        correlation_id,
                        command,
                        message
                    } if correlation_id == "corr-fail-1" && command == "send_message" && message == "boom"
                ));
            },
        );

        assert_eq!(result, Err("boom".to_string()));
        assert_eq!(timeline.borrow().as_slice(), ["run", "emit"]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bridge_integration_contract_send_then_cancel_uses_application_slice() {
        let db_conn = init_bridge_test_db();
        let a2a_conn = rusqlite::Connection::open_in_memory().expect("init a2a db");
        let state = build_test_state(db_conn, a2a_conn);

        let conversation_id = "conv-bridge-integration-1".to_string();
        {
            let db = state.db.lock().expect("lock db");
            db.execute(
                "INSERT INTO conversations (id, project_id, title, model, created_at, updated_at) VALUES (?1, NULL, 'Bridge Contract', 'gpt-x', 0, 0)",
                rusqlite::params![conversation_id.clone()],
            )
            .expect("seed conversation");
        }

        let send_result = run_send_message_use_case_with_provider(
            None,
            &state,
            &SendMessageCommand {
                correlation_id: "corr-bridge-integration-1".to_string(),
                conversation_id: conversation_id.clone(),
                content: "ping".to_string(),
                extra_context: None,
                thinking_enabled: None,
                assistant_msg_id: Some("assistant-bridge-1".to_string()),
                screenshot_base64: None,
                mode_id: None,
            },
            &FakeProvider,
            "gpt-x".to_string(),
            None,
        )
        .expect("run send use case through bridge slice");

        assert_eq!(send_result.user_message.role, "user");
        assert_eq!(send_result.user_message.content, "ping");

        {
            let db = state.db.lock().expect("lock db");
            let message_count: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
                    rusqlite::params![conversation_id],
                    |row| row.get(0),
                )
                .expect("count messages");
            assert_eq!(message_count, 2);

            let assistant_content: String = db
                .query_row(
                    "SELECT content FROM messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .expect("load assistant message");
            assert_eq!(assistant_content, "bridge hello");
        }

        let cancel_result = run_cancel_use_case(
            &state,
            &CancelRunCommand {
                correlation_id: "corr-bridge-integration-1".to_string(),
                run_id: Some("run-bridge-1".to_string()),
            },
        );
        assert!(cancel_result.is_ok());
        assert!(state.chat_cancel.load(Ordering::SeqCst));
    }
}
