use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

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

#[tauri::command]
pub async fn cmd_bridge_send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    model_state: State<'_, ModelManagerState>,
    payload: SendMessageCommand,
) -> Result<SendMessageResult, String> {
    let result = chat::cmd_chat_stream(
        app.clone(),
        state,
        model_state,
        payload.conversation_id,
        payload.content,
        payload.extra_context,
        payload.thinking_enabled,
        payload.assistant_msg_id,
        payload.screenshot_base64,
        payload.mode_id,
    )
    .await;

    match result {
        Ok(user_message) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandAccepted {
                    correlation_id: payload.correlation_id,
                    command: "send_message".to_string(),
                },
            );
            Ok(SendMessageResult { user_message })
        }
        Err(message) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandFailed {
                    correlation_id: payload.correlation_id,
                    command: "send_message".to_string(),
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn cmd_bridge_cancel_run(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CancelRunCommand,
) -> Result<(), String> {
    let result = chat::cmd_chat_cancel(state);
    match result {
        Ok(()) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandAccepted {
                    correlation_id: payload.correlation_id,
                    command: "cancel_run".to_string(),
                },
            );
            Ok(())
        }
        Err(message) => {
            emit_bridge_event(
                &app,
                BridgeEvent::CommandFailed {
                    correlation_id: payload.correlation_id,
                    command: "cancel_run".to_string(),
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}
