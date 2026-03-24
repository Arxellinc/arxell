use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

use arx_domain::{ChatProvider, DomainError, ProviderRequest, ProviderResponse, TokenSink};

use crate::commands::bridge::{run_cancel_use_case, run_send_message_use_case_with_provider};
use crate::AppState;

pub use crate::commands::bridge::{CancelRunCommand, SendMessageCommand, SendMessageResult};

struct TestProvider;

impl ChatProvider for TestProvider {
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

pub fn build_bridge_test_state() -> Result<AppState, String> {
    let db = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
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
    .map_err(|e| e.to_string())?;

    let a2a_db = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;

    Ok(AppState {
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
    })
}

pub fn seed_bridge_conversation(state: &AppState, conversation_id: &str) -> Result<(), String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    db.execute(
        "INSERT INTO conversations (id, project_id, title, model, created_at, updated_at) VALUES (?1, NULL, 'Bridge Contract', 'gpt-x', 0, 0)",
        rusqlite::params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn bridge_send_message_slice(
    state: &AppState,
    payload: SendMessageCommand,
) -> Result<SendMessageResult, String> {
    run_send_message_use_case_with_provider(
        None,
        state,
        &payload,
        &TestProvider,
        "gpt-x".to_string(),
        None,
    )
}

pub fn bridge_cancel_slice(state: &AppState, payload: CancelRunCommand) -> Result<(), String> {
    run_cancel_use_case(state, &payload)
}
