#[cfg(not(feature = "tauri-runtime"))]
use app_foundation::app::AppContext;
#[cfg(not(feature = "tauri-runtime"))]
use app_foundation::contracts::ChatSendRequest;

#[cfg(feature = "tauri-runtime")]
use app_foundation::app::AppContext;
#[cfg(feature = "tauri-runtime")]
use app_foundation::contracts::{
    ApiConnectionCreateRequest, ApiConnectionCreateResponse, ApiConnectionDeleteRequest,
    ApiConnectionDeleteResponse, ApiConnectionReverifyRequest, ApiConnectionReverifyResponse,
    ApiConnectionGetSecretRequest, ApiConnectionGetSecretResponse,
    ApiConnectionUpdateRequest, ApiConnectionUpdateResponse,
    ApiConnectionsListRequest, ApiConnectionsListResponse, AppVersionResponse, ChatCancelRequest,
    ChatCancelResponse, ChatDeleteConversationRequest, ChatDeleteConversationResponse,
    ChatGetMessagesRequest, ChatGetMessagesResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, WebSearchRequest,
    WebSearchResponse,
    DevicesProbeMicrophoneRequest, DevicesProbeMicrophoneResponse, LlamaRuntimeInstallRequest,
    LlamaRuntimeInstallResponse, LlamaRuntimeStartRequest, LlamaRuntimeStartResponse,
    LlamaRuntimeStatusRequest, LlamaRuntimeStatusResponse, LlamaRuntimeStopRequest,
    LlamaRuntimeStopResponse, ModelManagerDeleteInstalledRequest,
    ModelManagerDeleteInstalledResponse, ModelManagerDownloadHfRequest,
    ModelManagerDownloadHfResponse, ModelManagerListCatalogCsvRequest,
    ModelManagerListCatalogCsvResponse, ModelManagerListInstalledRequest,
    ModelManagerListInstalledResponse, ModelManagerSearchHfRequest, ModelManagerSearchHfResponse,
    TerminalCloseSessionRequest, TerminalCloseSessionResponse, TerminalInputRequest,
    TerminalInputResponse, TerminalOpenSessionRequest, TerminalOpenSessionResponse,
    TerminalResizeRequest, TerminalResizeResponse, WorkspaceToolSetEnabledRequest,
    WorkspaceToolSetEnabledResponse, WorkspaceToolsExportRequest, WorkspaceToolsExportResponse,
    WorkspaceToolsImportRequest, WorkspaceToolsImportResponse, WorkspaceToolsListRequest,
    WorkspaceToolsListResponse,
};
#[cfg(feature = "tauri-runtime")]
use app_foundation::ipc::tauri_bridge::{attach_event_forwarder, TauriBridgeState};
#[cfg(feature = "tauri-runtime")]
use app_foundation::stt::STTState;
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
        thinking_enabled: Some(true),
        max_tokens: None,
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
        api_registry: std::sync::Arc::clone(&app_context.api_registry),
        web_search: std::sync::Arc::clone(&app_context.web_search),
        runtime: std::sync::Arc::clone(&app_context.runtime),
        permissions: std::sync::Arc::clone(&app_context.permissions),
        model_manager: std::sync::Arc::clone(&app_context.model_manager),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            attach_event_forwarder(app.handle().clone(), hub.clone());
            if let Some(window) = app.get_webview_window("main") {
                restore_window_state(&window);
            }
            // Linux WebKit permission handler for microphone access
            #[cfg(target_os = "linux")]
            {
                use log::info;
                use webkit2gtk::{PermissionRequestExt, WebViewExt};
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.with_webview(|webview| {
                        // Connect permission request handler to auto-grant all media permissions
                        webview
                            .inner()
                            .connect_permission_request(move |_wv, request| {
                                info!("[webkit] granting permission for request");
                                // Grant all permission requests (this is a development-only setting)
                                request.allow();
                                true
                            });
                    });
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::CloseRequested { .. } => {
                    if matches!(event, WindowEvent::CloseRequested { .. }) {
                        if let Some(state) = window.try_state::<TauriBridgeState>() {
                            state.runtime.shutdown("app-window-close");
                        }
                    }
                    persist_window_state(window);
                }
                _ => {}
            }
        })
        .manage(state)
        .manage(STTState::new())
        .invoke_handler(tauri::generate_handler![
            cmd_chat_send_message,
            cmd_chat_cancel_message,
            cmd_chat_delete_conversation,
            cmd_chat_get_messages,
            cmd_chat_list_conversations,
            cmd_terminal_open_session,
            cmd_terminal_send_input,
            cmd_terminal_resize,
            cmd_terminal_close_session,
            cmd_workspace_tools_list,
            cmd_workspace_tool_set_enabled,
            cmd_workspace_tools_export,
            cmd_workspace_tools_import,
            cmd_api_connections_list,
            cmd_api_connection_create,
            cmd_api_connection_update,
            cmd_api_connection_reverify,
            cmd_api_connection_delete,
            cmd_api_connection_get_secret,
            cmd_web_search,
            cmd_devices_probe_microphone,
            cmd_app_version,
            cmd_llama_runtime_status,
            cmd_llama_runtime_install_engine,
            cmd_llama_runtime_start,
            cmd_llama_runtime_stop,
            cmd_model_manager_list_installed,
            cmd_model_manager_search_hf,
            cmd_model_manager_download_hf,
            cmd_model_manager_delete_installed,
            cmd_model_manager_list_catalog_csv,
            start_stt,
            stop_stt,
            stt_status,
            transcribe_chunk
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn start_stt(app: tauri::AppHandle, state: tauri::State<'_, STTState>) -> Result<(), String> {
    use log::info;
    use tauri::Emitter;

    info!("Starting STT service");
    let supervisor = state.supervisor.lock().await;
    supervisor.start(&app).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stop_stt(state: tauri::State<'_, STTState>) -> Result<(), String> {
    use log::info;

    info!("Stopping STT service");
    let supervisor = state.supervisor.lock().await;
    supervisor.stop().await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_status(
    state: tauri::State<'_, STTState>,
) -> Result<app_foundation::stt::events::STTStatusPayload, String> {
    use app_foundation::stt::supervisor::SupervisorStatus;

    let supervisor = state.supervisor.lock().await;
    let status = supervisor.status().await;

    match status {
        SupervisorStatus::Starting => Ok(app_foundation::stt::events::STTStatusPayload {
            status: "starting".to_string(),
            message: None,
        }),
        SupervisorStatus::Running => Ok(app_foundation::stt::events::STTStatusPayload {
            status: "running".to_string(),
            message: None,
        }),
        SupervisorStatus::Stopped => Ok(app_foundation::stt::events::STTStatusPayload {
            status: "stopped".to_string(),
            message: None,
        }),
        SupervisorStatus::Error(msg) => Ok(app_foundation::stt::events::STTStatusPayload {
            status: "error".to_string(),
            message: Some(msg),
        }),
    }
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn transcribe_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
    utterance_id: String,
) -> Result<(), String> {
    use log::{error, info};
    use tauri::Emitter;

    let supervisor = state.supervisor.lock().await;

    // Get endpoint
    let endpoint = match supervisor.endpoint().await {
        Some(e) => e,
        None => {
            let err = "STT service not running".to_string();
            let _ = app.emit(
                "pipeline://error",
                app_foundation::stt::events::PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: err.clone(),
                    details: None,
                },
            );
            return Err(err);
        }
    };

    // Extract port from endpoint
    let port = endpoint
        .strip_prefix("http://127.0.0.1:")
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| "Invalid endpoint".to_string())?;

    // Create client and run inference
    let client = app_foundation::stt::client::WhisperClient::new(port);
    match client.transcribe(&pcm_samples).await {
        Ok(transcript) => {
            info!("Transcription complete: {} chars", transcript.len());

            // Emit transcript event
            let _ = app.emit(
                "stt://transcript",
                app_foundation::stt::events::TranscriptPayload {
                    text: transcript,
                    is_final: true,
                    utterance_id,
                },
            );

            Ok(())
        }
        Err(e) => {
            error!("Transcription failed: {}", e);

            // Emit error event but don't restart - transient errors don't need restart
            let _ = app.emit(
                "pipeline://error",
                app_foundation::stt::events::PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: format!("Transcription failed: {}", e),
                    details: None,
                },
            );

            // Return error to frontend so it can be handled
            Err(e)
        }
    }
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
async fn cmd_chat_cancel_message(
    state: State<'_, TauriBridgeState>,
    request: ChatCancelRequest,
) -> Result<ChatCancelResponse, String> {
    state.chat.cancel_message(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_chat_delete_conversation(
    state: State<'_, TauriBridgeState>,
    request: ChatDeleteConversationRequest,
) -> Result<ChatDeleteConversationResponse, String> {
    state.chat.delete_conversation(request).await
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
#[tauri::command]
async fn cmd_workspace_tools_export(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolsExportRequest,
) -> Result<WorkspaceToolsExportResponse, String> {
    let payload_json = state.workspace_tools.export_snapshot_json()?;
    Ok(WorkspaceToolsExportResponse {
        correlation_id: request.correlation_id,
        file_name: "arxell-tools-registry.json".to_string(),
        payload_json,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_workspace_tools_import(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolsImportRequest,
) -> Result<WorkspaceToolsImportResponse, String> {
    let tools = state
        .workspace_tools
        .import_snapshot_json(request.payload_json.as_str())?;
    Ok(WorkspaceToolsImportResponse {
        correlation_id: request.correlation_id,
        tools,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connections_list(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionsListRequest,
) -> Result<ApiConnectionsListResponse, String> {
    Ok(ApiConnectionsListResponse {
        correlation_id: request.correlation_id,
        connections: state.api_registry.list(),
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connection_create(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionCreateRequest,
) -> Result<ApiConnectionCreateResponse, String> {
    let connection = state
        .api_registry
        .create_and_verify(app_foundation::api_registry::NewApiConnectionInput {
            api_type: request.api_type,
            api_url: request.api_url,
            name: request.name,
            api_key: request.api_key,
            model_name: request.model_name,
            cost_per_month_usd: request.cost_per_month_usd,
            api_standard_path: request.api_standard_path,
        })
        .await?;
    Ok(ApiConnectionCreateResponse {
        correlation_id: request.correlation_id,
        connection,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connection_reverify(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionReverifyRequest,
) -> Result<ApiConnectionReverifyResponse, String> {
    let connection = state.api_registry.reverify(request.id.as_str()).await?;
    Ok(ApiConnectionReverifyResponse {
        correlation_id: request.correlation_id,
        connection,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connection_update(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionUpdateRequest,
) -> Result<ApiConnectionUpdateResponse, String> {
    let connection = state.api_registry.update(
        request.id.as_str(),
        app_foundation::api_registry::UpdateApiConnectionInput {
            api_type: request.api_type,
            api_url: request.api_url,
            name: request.name,
            api_key: request.api_key,
            model_name: request.model_name,
            cost_per_month_usd: request.cost_per_month_usd,
            api_standard_path: request.api_standard_path,
        },
    )?;
    Ok(ApiConnectionUpdateResponse {
        correlation_id: request.correlation_id,
        connection,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connection_delete(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionDeleteRequest,
) -> Result<ApiConnectionDeleteResponse, String> {
    let deleted = state.api_registry.delete(request.id.as_str())?;
    Ok(ApiConnectionDeleteResponse {
        correlation_id: request.correlation_id,
        id: request.id,
        deleted,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connection_get_secret(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionGetSecretRequest,
) -> Result<ApiConnectionGetSecretResponse, String> {
    let api_key = state.api_registry.get_secret_api_key(request.id.as_str())?;
    Ok(ApiConnectionGetSecretResponse {
        correlation_id: request.correlation_id,
        id: request.id,
        api_key,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_web_search(
    state: State<'_, TauriBridgeState>,
    request: WebSearchRequest,
) -> Result<WebSearchResponse, String> {
    let result = state
        .web_search
        .search(app_foundation::app::web_search_service::WebSearchRequest {
            query: request.query,
            mode: request.mode,
            num: request.num,
            page: request.page,
        })
        .await?;
    let result_value = serde_json::to_value(result)
        .map_err(|e| format!("failed serializing web search response: {e}"))?;
    Ok(WebSearchResponse {
        correlation_id: request.correlation_id,
        result: result_value,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_devices_probe_microphone(
    state: State<'_, TauriBridgeState>,
    request: DevicesProbeMicrophoneRequest,
) -> Result<DevicesProbeMicrophoneResponse, String> {
    let service = std::sync::Arc::clone(&state.permissions);
    tokio::task::spawn_blocking(move || service.probe_microphone(request))
        .await
        .map_err(|e| format!("devices probe task failed: {e}"))?
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_app_version() -> Result<AppVersionResponse, String> {
    Ok(AppVersionResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_llama_runtime_status(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: LlamaRuntimeStatusRequest,
) -> Result<LlamaRuntimeStatusResponse, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let mut status = state
        .runtime
        .status(request.correlation_id.as_str(), app_data.as_path());
    for engine in status.engines.iter_mut() {
        engine.is_bundled =
            resolve_bundled_engine_binary(&app, engine.engine_id.as_str()).is_some();
    }
    Ok(status)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_llama_runtime_install_engine(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: LlamaRuntimeInstallRequest,
) -> Result<LlamaRuntimeInstallResponse, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let bundled = resolve_bundled_engine_binary(&app, request.engine_id.as_str());
    let runtime = std::sync::Arc::clone(&state.runtime);
    let correlation_id = request.correlation_id.clone();
    let engine_id = request.engine_id.clone();
    let app_data_owned = app_data.clone();
    tokio::task::spawn_blocking(move || {
        runtime.install_engine(
            correlation_id.as_str(),
            engine_id.as_str(),
            app_data_owned.as_path(),
            bundled,
        )
    })
    .await
    .map_err(|e| format!("llama runtime install task failed: {e}"))?
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_llama_runtime_start(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: LlamaRuntimeStartRequest,
) -> Result<LlamaRuntimeStartResponse, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    state.runtime.start(&request, app_data.as_path())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_llama_runtime_stop(
    state: State<'_, TauriBridgeState>,
    request: LlamaRuntimeStopRequest,
) -> Result<LlamaRuntimeStopResponse, String> {
    state.runtime.stop(request.correlation_id.as_str())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_model_manager_list_installed(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerListInstalledRequest,
) -> Result<ModelManagerListInstalledResponse, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let service = std::sync::Arc::clone(&state.model_manager);
    let correlation_id = request.correlation_id.clone();
    let app_data_owned = app_data.clone();
    let models = tokio::task::spawn_blocking(move || {
        service.list_installed(correlation_id.as_str(), app_data_owned.as_path())
    })
    .await
    .map_err(|e| format!("model manager list task failed: {e}"))??;
    Ok(ModelManagerListInstalledResponse {
        correlation_id: request.correlation_id,
        models,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_model_manager_search_hf(
    state: State<'_, TauriBridgeState>,
    request: ModelManagerSearchHfRequest,
) -> Result<ModelManagerSearchHfResponse, String> {
    let service = std::sync::Arc::clone(&state.model_manager);
    let correlation_id = request.correlation_id.clone();
    let query = request.query.clone();
    let limit = request.limit.unwrap_or(8) as usize;
    let results = tokio::task::spawn_blocking(move || {
        service.search_hf(correlation_id.as_str(), &query, limit)
    })
    .await
    .map_err(|e| format!("model manager search task failed: {e}"))??;
    Ok(ModelManagerSearchHfResponse {
        correlation_id: request.correlation_id,
        results,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_model_manager_download_hf(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerDownloadHfRequest,
) -> Result<ModelManagerDownloadHfResponse, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let service = std::sync::Arc::clone(&state.model_manager);
    let correlation_id = request.correlation_id.clone();
    let repo_id = request.repo_id.clone();
    let file_name = request.file_name.clone();
    let app_data_owned = app_data.clone();
    let model = tokio::task::spawn_blocking(move || {
        service.download_from_hf(
            correlation_id.as_str(),
            app_data_owned.as_path(),
            repo_id.as_str(),
            file_name.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("model manager download task failed: {e}"))??;
    Ok(ModelManagerDownloadHfResponse {
        correlation_id: request.correlation_id,
        model,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_model_manager_delete_installed(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerDeleteInstalledRequest,
) -> Result<ModelManagerDeleteInstalledResponse, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let service = std::sync::Arc::clone(&state.model_manager);
    let correlation_id = request.correlation_id.clone();
    let model_id = request.model_id.clone();
    let app_data_owned = app_data.clone();
    tokio::task::spawn_blocking(move || {
        service.delete_installed(
            correlation_id.as_str(),
            app_data_owned.as_path(),
            model_id.as_str(),
        )
    })
    .await
    .map_err(|e| format!("model manager delete task failed: {e}"))??;
    Ok(ModelManagerDeleteInstalledResponse {
        correlation_id: request.correlation_id,
        model_id: request.model_id,
        deleted: true,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_model_manager_list_catalog_csv(
    state: State<'_, TauriBridgeState>,
    request: ModelManagerListCatalogCsvRequest,
) -> Result<ModelManagerListCatalogCsvResponse, String> {
    let service = std::sync::Arc::clone(&state.model_manager);
    let correlation_id = request.correlation_id.clone();
    let list_name = request.list_name.clone();
    let rows = tokio::task::spawn_blocking(move || {
        service.list_catalog_csv(correlation_id.as_str(), list_name.as_str())
    })
    .await
    .map_err(|e| format!("model manager list catalog csv task failed: {e}"))??;
    Ok(ModelManagerListCatalogCsvResponse {
        correlation_id: request.correlation_id,
        list_name: request.list_name,
        rows,
    })
}

#[cfg(feature = "tauri-runtime")]
fn resolve_bundled_engine_binary(app: &tauri::AppHandle, engine_id: &str) -> Option<PathBuf> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let binary_name = app_foundation::app::runtime_service::engine_binary_filename();
    let rel_candidates = [
        format!("llama-runtime/{engine_id}/{binary_name}"),
        format!("resources/llama-runtime/{engine_id}/{binary_name}"),
        format!("llama-runtime/{os}-{arch}/{engine_id}/{binary_name}"),
        format!("resources/llama-runtime/{os}-{arch}/{engine_id}/{binary_name}"),
    ];
    for rel in rel_candidates {
        if let Ok(path) = app
            .path()
            .resolve(rel.as_str(), tauri::path::BaseDirectory::Resource)
        {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
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
        .unwrap_or_else(|_| std::env::temp_dir().join("arxell-lite"));
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
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            width, height,
        )));
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )));
    }
    if state.maximized {
        let _ = window.maximize();
    }
}
