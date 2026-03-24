#[cfg(not(feature = "tauri-runtime"))]
use app_foundation::app::AppContext;
#[cfg(not(feature = "tauri-runtime"))]
use app_foundation::contracts::ChatSendRequest;

#[cfg(feature = "tauri-runtime")]
use app_foundation::app::AppContext;
#[cfg(feature = "tauri-runtime")]
use app_foundation::contracts::{
    ChatGetMessagesRequest, ChatGetMessagesResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, TerminalCloseSessionRequest,
    TerminalCloseSessionResponse, TerminalInputRequest, TerminalInputResponse,
    TerminalOpenSessionRequest, TerminalOpenSessionResponse, TerminalResizeRequest,
    TerminalResizeResponse, WorkspaceToolSetEnabledRequest, WorkspaceToolSetEnabledResponse,
    WorkspaceToolsListRequest, WorkspaceToolsListResponse,
};
#[cfg(feature = "tauri-runtime")]
use app_foundation::ipc::tauri_bridge::{TauriBridgeState, attach_event_forwarder};
#[cfg(feature = "tauri-runtime")]
use serde::{Deserialize, Serialize};
#[cfg(feature = "tauri-runtime")]
use std::path::PathBuf;
#[cfg(feature = "tauri-runtime")]
use tauri::{Manager, State, WindowEvent};

#[cfg(not(feature = "tauri-runtime"))]
#[tokio::main]
async fn main() {
    let app = AppContext::new();
    let mut rx = app.ipc.event_stream();
    tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            println!(
                "[event] subsystem={:?} action={} stage={:?} corr={}",
                event.subsystem, event.action, event.stage, event.correlation_id
            );
        }
    });

    let request = ChatSendRequest {
        conversation_id: "foundation-demo".to_string(),
        user_message: "Hello foundation".to_string(),
        correlation_id: "demo-001".to_string(),
    };

    let result = app.ipc.chat.send_message(request).await;
    match result {
        Ok(response) => {
            println!("assistant: {}", response.assistant_message);
        }
        Err(err) => {
            eprintln!("error: {err}");
        }
    }
}

#[cfg(feature = "tauri-runtime")]
fn main() {
    let app_context = AppContext::new();
    let hub = app_context.ipc.event_hub();
    let state = TauriBridgeState {
        chat: std::sync::Arc::new(app_context.ipc.chat.clone()),
        terminal: std::sync::Arc::new(app_context.ipc.terminal.clone()),
        hub: hub.clone(),
        workspace_tools: std::sync::Arc::clone(&app_context.workspace_tools),
    };

    tauri::Builder::default()
        .setup(move |app| {
            attach_event_forwarder(app.handle().clone(), hub.clone());
            if let Some(window) = app.get_webview_window("main") {
                restore_window_state(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. } => {
                    persist_window_state(window);
                }
                _ => {}
            }
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            cmd_chat_send_message,
            cmd_chat_get_messages,
            cmd_chat_list_conversations,
            cmd_terminal_open_session,
            cmd_terminal_send_input,
            cmd_terminal_resize,
            cmd_terminal_close_session,
            cmd_workspace_tools_list,
            cmd_workspace_tool_set_enabled
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_chat_send_message(
    state: State<'_, TauriBridgeState>,
    request: ChatSendRequest,
) -> Result<ChatSendResponse, String> {
    state.chat.send_message(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_chat_get_messages(
    state: State<'_, TauriBridgeState>,
    request: ChatGetMessagesRequest,
) -> Result<ChatGetMessagesResponse, String> {
    state.chat.get_messages(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_chat_list_conversations(
    state: State<'_, TauriBridgeState>,
    request: ChatListConversationsRequest,
) -> Result<ChatListConversationsResponse, String> {
    state.chat.list_conversations(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_terminal_open_session(
    state: State<'_, TauriBridgeState>,
    request: TerminalOpenSessionRequest,
) -> Result<TerminalOpenSessionResponse, String> {
    state.terminal.open_session(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_terminal_send_input(
    state: State<'_, TauriBridgeState>,
    request: TerminalInputRequest,
) -> Result<TerminalInputResponse, String> {
    state.terminal.send_input(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_terminal_resize(
    state: State<'_, TauriBridgeState>,
    request: TerminalResizeRequest,
) -> Result<TerminalResizeResponse, String> {
    state.terminal.resize(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_terminal_close_session(
    state: State<'_, TauriBridgeState>,
    request: TerminalCloseSessionRequest,
) -> Result<TerminalCloseSessionResponse, String> {
    state.terminal.close_session(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_workspace_tools_list(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolsListRequest,
) -> Result<WorkspaceToolsListResponse, String> {
    Ok(WorkspaceToolsListResponse {
        tools: state.workspace_tools.list(),
        correlation_id: request.correlation_id,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_workspace_tool_set_enabled(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolSetEnabledRequest,
) -> Result<WorkspaceToolSetEnabledResponse, String> {
    state
        .workspace_tools
        .set_enabled(request.tool_id.as_str(), request.enabled)
        .map_err(|e| e.to_string())?;
    Ok(WorkspaceToolSetEnabledResponse {
        correlation_id: request.correlation_id,
        tool_id: request.tool_id,
        enabled: request.enabled,
    })
}

#[cfg(feature = "tauri-runtime")]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedWindowState {
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
    maximized: bool,
}

#[cfg(feature = "tauri-runtime")]
fn window_state_path(handle: &tauri::AppHandle) -> PathBuf {
    let base = handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("refactor-ai-foundation"));
    base.join("window-state.json")
}

#[cfg(feature = "tauri-runtime")]
fn persist_window_state(window: &tauri::Window) {
    let path = window_state_path(&window.app_handle());
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut state = PersistedWindowState::default();
    if let Ok(position) = window.outer_position() {
        state.x = Some(position.x);
        state.y = Some(position.y);
    }
    if let Ok(size) = window.outer_size() {
        state.width = Some(size.width);
        state.height = Some(size.height);
    }
    state.maximized = window.is_maximized().unwrap_or(false);

    if let Ok(payload) = serde_json::to_string(&state) {
        let _ = std::fs::write(path, payload);
    }
}

#[cfg(feature = "tauri-runtime")]
fn restore_window_state(window: &tauri::WebviewWindow) {
    let path = window_state_path(&window.app_handle());
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(state) = serde_json::from_str::<PersistedWindowState>(&raw) else {
        return;
    };

    if let (Some(width), Some(height)) = (state.width, state.height) {
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(width, height)));
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
    }
    if state.maximized {
        let _ = window.maximize();
    }
}
