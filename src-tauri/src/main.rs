#[cfg(not(feature = "tauri-runtime"))]
use arxell_lite::app::AppContext;
#[cfg(not(feature = "tauri-runtime"))]
use arxell_lite::contracts::ChatSendRequest;

#[cfg(feature = "tauri-runtime")]
use arxell_lite::app::AppContext;
#[cfg(feature = "tauri-runtime")]
use arxell_lite::app_paths;
#[cfg(feature = "tauri-runtime")]
use arxell_lite::contracts::{
    ApiConnectionCreateRequest, ApiConnectionCreateResponse, ApiConnectionDeleteRequest,
    ApiConnectionDeleteResponse, ApiConnectionProbeRequest, ApiConnectionProbeResponse,
    ApiConnectionReverifyRequest, ApiConnectionReverifyResponse, ApiConnectionUpdateRequest,
    ApiConnectionUpdateResponse, ApiConnectionsExportRequest, ApiConnectionsExportResponse,
    ApiConnectionsImportRequest, ApiConnectionsImportResponse, ApiConnectionsListRequest,
    ApiConnectionsListResponse, AppResourceUsageRequest, AppResourceUsageResponse,
    AppVersionResponse, ChatCancelRequest, ChatCancelResponse, ChatDeleteConversationRequest,
    ChatDeleteConversationResponse, ChatGetMessagesRequest, ChatGetMessagesResponse,
    ChatInspectContextRequest, ChatInspectContextResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, CustomItemDeleteRequest,
    CustomItemDeleteResponse, CustomItemUpsertRequest, CustomItemUpsertResponse,
    CustomToolCapabilityInvokeRequest, CustomToolCapabilityInvokeResponse,
    DevicesProbeMicrophoneRequest, DevicesProbeMicrophoneResponse, EventSeverity, EventStage,
    FilesListDirectoryRequest, FilesListDirectoryResponse, LlamaRuntimeInstallRequest,
    LlamaRuntimeInstallResponse, LlamaRuntimeStartRequest, LlamaRuntimeStartResponse,
    LlamaRuntimeStatusRequest, LlamaRuntimeStatusResponse, LlamaRuntimeStopRequest,
    LlamaRuntimeStopResponse, LooperPreviewRequest, LooperPreviewResponse, MemoryDeleteRequest,
    MemoryDeleteResponse, MemoryUpsertRequest, MemoryUpsertResponse,
    ModelManagerCancelDownloadRequest, ModelManagerCancelDownloadResponse,
    ModelManagerDeleteInstalledRequest, ModelManagerDeleteInstalledResponse,
    ModelManagerDownloadHfRequest, ModelManagerDownloadHfResponse,
    ModelManagerListCatalogCsvRequest, ModelManagerListCatalogCsvResponse,
    ModelManagerListInstalledRequest, ModelManagerListInstalledResponse,
    ModelManagerRefreshUnslothCatalogRequest, ModelManagerRefreshUnslothCatalogResponse,
    ModelManagerSearchHfRequest, ModelManagerSearchHfResponse, PluginCapabilityInvokeRequest,
    PluginCapabilityInvokeResponse, ReferenceFileSetRequest, ReferenceFileSetResponse,
    SkillCreateRequest, SkillCreateResponse, Subsystem, SystemPromptSetRequest,
    SystemPromptSetResponse, TerminalCloseSessionRequest, TerminalCloseSessionResponse,
    TerminalInputRequest, TerminalInputResponse, TerminalOpenSessionRequest,
    TerminalOpenSessionResponse, TerminalResizeRequest, TerminalResizeResponse, ToolInvokeRequest,
    ToolInvokeResponse, TtsListVoicesRequest,
    TtsListVoicesResponse, TtsSelfTestRequest, TtsSelfTestResponse, TtsSettingsGetRequest,
    TtsSettingsGetResponse, TtsSettingsSetRequest, TtsSettingsSetResponse, TtsSpeakRequest,
    TtsSpeakResponse, TtsSpeakStreamResponse, TtsStatusRequest, TtsStatusResponse, TtsStopRequest,
    TtsStopResponse,
    UserProjectEnsureRequest, UserProjectEnsureResponse, UserProjectsRootsRequest,
    UserProjectsRootsResponse, VoiceGetRuntimeDiagnosticsRequest, VoiceGetVadSettingsRequest,
    VoiceGetVadSettingsResponse, VoiceListVadMethodsRequest, VoiceListVadMethodsResponse,
    VoiceRequestHandoffRequest, VoiceRuntimeSnapshotResponse, VoiceSetDuplexModeRequest,
    VoiceSetShadowMethodRequest, VoiceSetVadMethodRequest, VoiceStartSessionRequest,
    VoiceStartShadowEvalRequest, VoiceStopSessionRequest, VoiceStopShadowEvalRequest,
    VoiceUpdateVadConfigRequest, VoiceUpdateVadConfigResponse, WebSearchRequest, WebSearchResponse,
    WorkspaceToolCreateAppPluginRequest, WorkspaceToolCreateAppPluginResponse,
    WorkspaceToolForgetRequest, WorkspaceToolForgetResponse, WorkspaceToolSetEnabledRequest,
    WorkspaceToolSetEnabledResponse, WorkspaceToolSetIconRequest, WorkspaceToolSetIconResponse,
    WorkspaceToolsExportRequest, WorkspaceToolsExportResponse, WorkspaceToolsImportRequest,
    WorkspaceToolsImportResponse, WorkspaceToolsListRequest, WorkspaceToolsListResponse,
};
#[cfg(feature = "tauri-runtime")]
use arxell_lite::ipc::tauri_bridge::{attach_event_forwarder, TauriBridgeState};
#[cfg(feature = "tauri-runtime")]
use arxell_lite::ipc::tool_runtime::{invoke_legacy_tool_command, invoke_tool};
#[cfg(feature = "tauri-runtime")]
use arxell_lite::tools::invoke::tasks::run_due_scheduled_tasks;
#[cfg(feature = "tauri-runtime")]
use arxell_lite::stt::STTState;
#[cfg(feature = "tauri-runtime")]
use arxell_lite::tts::TTSState;
#[cfg(feature = "tauri-runtime")]
use serde::{Deserialize, Serialize};
#[cfg(feature = "tauri-runtime")]
use serde_json::{json, Value};
#[cfg(feature = "tauri-runtime")]
use std::path::PathBuf;
#[cfg(feature = "tauri-runtime")]
use std::sync::Mutex;
#[cfg(feature = "tauri-runtime")]
use std::time::Instant;
#[cfg(feature = "tauri-runtime")]
use sysinfo::{Networks, ProcessRefreshKind, ProcessesToUpdate, System};
#[cfg(feature = "tauri-runtime")]
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(not(feature = "tauri-runtime"))]
#[tokio::main]
async fn main() {
    let app = match AppContext::new() {
        Ok(app) => app,
        Err(err) => {
            eprintln!("failed to initialize app context: {err}");
            std::process::exit(1);
        }
    };
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
        chat_mode: None,
        model_id: None,
        model_name: None,
        max_tokens: None,
        attachments: None,
        always_load_tool_keys: None,
        always_load_skill_keys: None,
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
struct AppResourceUsageSampler {
    system: System,
    networks: Networks,
    last_network_sample: Option<(Instant, u64, u64)>,
}

#[cfg(feature = "tauri-runtime")]
struct AppResourceUsageState {
    inner: Mutex<AppResourceUsageSampler>,
}

#[cfg(feature = "tauri-runtime")]
impl AppResourceUsageState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(AppResourceUsageSampler {
                system: System::new(),
                networks: Networks::new_with_refreshed_list(),
                last_network_sample: None,
            }),
        }
    }
}

#[cfg(feature = "tauri-runtime")]
fn main() {
    let app_context = match AppContext::new() {
        Ok(app_context) => app_context,
        Err(err) => {
            eprintln!("failed to initialize app context: {err}");
            std::process::exit(1);
        }
    };
    let hub = app_context.ipc.event_hub();
    let state = TauriBridgeState {
        chat: std::sync::Arc::new(app_context.ipc.chat.clone()),
        terminal: std::sync::Arc::new(app_context.ipc.terminal.clone()),
        looper_handler: std::sync::Arc::new(app_context.ipc.looper.clone()),
        voice_handler: std::sync::Arc::new(app_context.ipc.voice.clone()),
        hub: hub.clone(),
        workspace_tools: std::sync::Arc::clone(&app_context.workspace_tools),
        api_registry: std::sync::Arc::clone(&app_context.api_registry),
        web_search: std::sync::Arc::clone(&app_context.web_search),
        runtime: std::sync::Arc::clone(&app_context.runtime),
        user_projects: std::sync::Arc::clone(&app_context.user_projects),
        permissions: std::sync::Arc::clone(&app_context.permissions),
        model_manager: std::sync::Arc::clone(&app_context.model_manager),
        files: std::sync::Arc::clone(&app_context.files),
        tasks: std::sync::Arc::clone(&app_context.tasks),
        sheets: std::sync::Arc::clone(&app_context.sheets),
        voice: std::sync::Arc::clone(&app_context.voice),
    };
    let scheduler_state = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            attach_event_forwarder(app.handle().clone(), hub.clone());
            let scheduler_state = scheduler_state.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
                loop {
                    interval.tick().await;
                    let _ = run_due_scheduled_tasks(&scheduler_state, 16).await;
                }
            });
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
                        if let Some(tts_state) = window.try_state::<TTSState>() {
                            tts_state.shutdown();
                        }
                    }
                    persist_window_state(window);
                }
                _ => {}
            }
        })
        .manage(state)
        .manage(AppResourceUsageState::new())
        .manage(STTState::new())
        .manage(TTSState::new())
        .invoke_handler(tauri::generate_handler![
            cmd_chat_send_message,
            cmd_chat_cancel_message,
            cmd_chat_delete_conversation,
            cmd_chat_get_messages,
            cmd_chat_list_conversations,
            cmd_chat_inspect_context,
            cmd_memory_upsert,
            cmd_memory_delete,
            cmd_system_prompt_set,
            cmd_custom_item_upsert,
            cmd_custom_item_delete,
            cmd_skill_create,
            cmd_reference_file_set,
            cmd_terminal_open_session,
            cmd_terminal_send_input,
            cmd_terminal_resize,
            cmd_terminal_close_session,
            cmd_looper_open_preview_window,
            cmd_workspace_tools_list,
            cmd_workspace_tool_set_enabled,
            cmd_workspace_tool_set_icon,
            cmd_workspace_tool_forget,
            cmd_workspace_tool_create_app_plugin,
            cmd_workspace_tools_export,
            cmd_workspace_tools_import,
            write_text_file,
            cmd_user_projects_roots,
            cmd_user_project_ensure,
            cmd_api_connections_list,
            cmd_api_connections_export,
            cmd_api_connections_import,
            cmd_api_connection_create,
            cmd_api_connection_probe,
            cmd_api_connection_update,
            cmd_api_connection_reverify,
            cmd_api_connection_delete,
            cmd_web_search,
            cmd_devices_probe_microphone,
            cmd_app_version,
            cmd_app_resource_usage,
            cmd_llama_runtime_status,
            cmd_llama_runtime_install_engine,
            cmd_llama_runtime_start,
            cmd_llama_runtime_stop,
            cmd_model_manager_list_installed,
            cmd_model_manager_search_hf,
            cmd_model_manager_download_hf,
            cmd_model_manager_cancel_download,
            cmd_model_manager_delete_installed,
            cmd_model_manager_list_catalog_csv,
            cmd_model_manager_refresh_unsloth_catalog,
            cmd_files_list_directory,
            cmd_tool_invoke,
            cmd_custom_tool_capability_invoke,
            cmd_plugin_capability_invoke,
            start_stt,
            stop_stt,
            stt_status,
            stt_set_backend,
            stt_get_backend,
            stt_set_model,
            stt_set_language,
            stt_set_threads,
            stt_download_model,
            stt_list_models,
            transcribe_chunk,
            transcribe_partial_chunk,
            stt_stream_reset,
            stt_stream_configure,
            stt_stream_ingest,
            cmd_tts_status,
            cmd_tts_list_voices,
            cmd_tts_speak,
            cmd_tts_speak_stream,
            cmd_tts_stop,
            cmd_tts_self_test,
            cmd_tts_settings_get,
            cmd_tts_settings_set,
            cmd_voice_list_vad_methods,
            cmd_voice_get_vad_settings,
            cmd_voice_set_vad_method,
            cmd_voice_update_vad_config,
            cmd_voice_start_session,
            cmd_voice_stop_session,
            cmd_voice_request_handoff,
            cmd_voice_set_shadow_method,
            cmd_voice_start_shadow_eval,
            cmd_voice_stop_shadow_eval,
            cmd_voice_set_duplex_mode,
            cmd_voice_get_runtime_diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn start_stt(app: tauri::AppHandle, state: tauri::State<'_, STTState>) -> Result<(), String> {
    arxell_lite::stt::start_stt(app, state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stop_stt(state: tauri::State<'_, STTState>) -> Result<(), String> {
    arxell_lite::stt::stop_stt(state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_status(
    state: tauri::State<'_, STTState>,
) -> Result<arxell_lite::stt::events::STTStatusPayload, String> {
    arxell_lite::stt::stt_status(state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_set_backend(
    state: tauri::State<'_, STTState>,
    backend: String,
) -> Result<String, String> {
    arxell_lite::stt::stt_set_backend(state, backend).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_get_backend(state: tauri::State<'_, STTState>) -> Result<String, String> {
    arxell_lite::stt::stt_get_backend(state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    file_name: String,
) -> Result<String, String> {
    arxell_lite::stt::stt_download_model(app, state, file_name).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_list_models(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    arxell_lite::stt::stt_list_models(app).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_set_model(state: tauri::State<'_, STTState>, model: String) -> Result<String, String> {
    arxell_lite::stt::stt_set_model(state, model).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_set_language(
    state: tauri::State<'_, STTState>,
    language: String,
) -> Result<String, String> {
    arxell_lite::stt::stt_set_language(state, language).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_set_threads(state: tauri::State<'_, STTState>, threads: i32) -> Result<i32, String> {
    arxell_lite::stt::stt_set_threads(state, threads).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_status(
    app: tauri::AppHandle,
    request: TtsStatusRequest,
) -> Result<TtsStatusResponse, String> {
    arxell_lite::tts::status(&app, request)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_list_voices(
    app: tauri::AppHandle,
    request: TtsListVoicesRequest,
) -> Result<TtsListVoicesResponse, String> {
    arxell_lite::tts::list_voices(&app, request)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_speak(
    app: tauri::AppHandle,
    tts_state: tauri::State<'_, TTSState>,
    request: TtsSpeakRequest,
) -> Result<TtsSpeakResponse, String> {
    arxell_lite::tts::speak(&app, request, &tts_state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_speak_stream(
    app: tauri::AppHandle,
    tts_state: tauri::State<'_, TTSState>,
    request: TtsSpeakRequest,
) -> Result<TtsSpeakStreamResponse, String> {
    arxell_lite::tts::speak_stream(&app, request, &tts_state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_stop(
    tts_state: tauri::State<'_, TTSState>,
    request: TtsStopRequest,
) -> Result<TtsStopResponse, String> {
    arxell_lite::tts::stop(request, &tts_state)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_self_test(
    app: tauri::AppHandle,
    tts_state: tauri::State<'_, TTSState>,
    request: TtsSelfTestRequest,
) -> Result<TtsSelfTestResponse, String> {
    arxell_lite::tts::self_test(&app, request, &tts_state).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_settings_get(
    app: tauri::AppHandle,
    request: TtsSettingsGetRequest,
) -> Result<TtsSettingsGetResponse, String> {
    arxell_lite::tts::settings_get(&app, request)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tts_settings_set(
    app: tauri::AppHandle,
    tts_state: tauri::State<'_, TTSState>,
    request: TtsSettingsSetRequest,
) -> Result<TtsSettingsSetResponse, String> {
    arxell_lite::tts::settings_set(&app, &tts_state, request)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_list_vad_methods(
    state: State<'_, TauriBridgeState>,
    request: VoiceListVadMethodsRequest,
) -> Result<VoiceListVadMethodsResponse, String> {
    state.voice_handler.list_vad_methods(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_get_vad_settings(
    state: State<'_, TauriBridgeState>,
    request: VoiceGetVadSettingsRequest,
) -> Result<VoiceGetVadSettingsResponse, String> {
    state.voice_handler.get_vad_settings(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_set_vad_method(
    state: State<'_, TauriBridgeState>,
    request: VoiceSetVadMethodRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.set_vad_method(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_update_vad_config(
    state: State<'_, TauriBridgeState>,
    request: VoiceUpdateVadConfigRequest,
) -> Result<VoiceUpdateVadConfigResponse, String> {
    state.voice_handler.update_vad_config(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_start_session(
    state: State<'_, TauriBridgeState>,
    request: VoiceStartSessionRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.start_session(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_stop_session(
    state: State<'_, TauriBridgeState>,
    request: VoiceStopSessionRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.stop_session(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_request_handoff(
    state: State<'_, TauriBridgeState>,
    request: VoiceRequestHandoffRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.request_handoff(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_set_shadow_method(
    state: State<'_, TauriBridgeState>,
    request: VoiceSetShadowMethodRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.set_shadow_method(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_start_shadow_eval(
    state: State<'_, TauriBridgeState>,
    request: VoiceStartShadowEvalRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.start_shadow_eval(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_stop_shadow_eval(
    state: State<'_, TauriBridgeState>,
    request: VoiceStopShadowEvalRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.stop_shadow_eval(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_set_duplex_mode(
    state: State<'_, TauriBridgeState>,
    request: VoiceSetDuplexModeRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.set_duplex_mode(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_voice_get_runtime_diagnostics(
    state: State<'_, TauriBridgeState>,
    request: VoiceGetRuntimeDiagnosticsRequest,
) -> Result<VoiceRuntimeSnapshotResponse, String> {
    state.voice_handler.runtime_diagnostics(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn transcribe_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
    utterance_id: String,
) -> Result<(), String> {
    arxell_lite::stt::transcribe_chunk(app, state, pcm_samples, utterance_id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn transcribe_partial_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
    utterance_id: String,
) -> Result<(), String> {
    arxell_lite::stt::transcribe_partial_chunk(app, state, pcm_samples, utterance_id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_stream_reset() -> Result<(), String> {
    arxell_lite::stt::stt_stream_reset().await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_stream_configure(
    start_frames: Option<u32>,
    end_frames: Option<u32>,
    pre_speech_ms: Option<u32>,
) -> Result<(), String> {
    arxell_lite::stt::stt_stream_configure(start_frames, end_frames, pre_speech_ms).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn stt_stream_ingest(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
) -> Result<(), String> {
    arxell_lite::stt::stt_stream_ingest(app, state, pcm_samples).await
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
async fn cmd_chat_inspect_context(
    state: State<'_, TauriBridgeState>,
    request: ChatInspectContextRequest,
) -> Result<ChatInspectContextResponse, String> {
    state.chat.inspect_context(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_memory_upsert(
    state: State<'_, TauriBridgeState>,
    request: MemoryUpsertRequest,
) -> Result<MemoryUpsertResponse, String> {
    state.chat.upsert_memory(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_memory_delete(
    state: State<'_, TauriBridgeState>,
    request: MemoryDeleteRequest,
) -> Result<MemoryDeleteResponse, String> {
    state.chat.delete_memory(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_system_prompt_set(
    state: State<'_, TauriBridgeState>,
    request: SystemPromptSetRequest,
) -> Result<SystemPromptSetResponse, String> {
    state.chat.set_system_prompt(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_custom_item_upsert(
    state: State<'_, TauriBridgeState>,
    request: CustomItemUpsertRequest,
) -> Result<CustomItemUpsertResponse, String> {
    state.chat.upsert_custom_item(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_custom_item_delete(
    state: State<'_, TauriBridgeState>,
    request: CustomItemDeleteRequest,
) -> Result<CustomItemDeleteResponse, String> {
    state.chat.delete_custom_item(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_skill_create(
    state: State<'_, TauriBridgeState>,
    request: SkillCreateRequest,
) -> Result<SkillCreateResponse, String> {
    state.chat.create_skill(request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_reference_file_set(
    state: State<'_, TauriBridgeState>,
    request: ReferenceFileSetRequest,
) -> Result<ReferenceFileSetResponse, String> {
    state.chat.set_reference_file(request).await
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
async fn cmd_looper_open_preview_window(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: LooperPreviewRequest,
) -> Result<LooperPreviewResponse, String> {
    let mut preview = state.looper_handler.start_preview(request.clone()).await?;
    if preview.url.is_none() {
        for _ in 0..24 {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            if let Some(url) = state.looper_handler.preview_url(&request.loop_id) {
                if preview_url_ready(&url).await {
                    preview.url = Some(url);
                    preview.status = "running".to_string();
                    break;
                }
            }
        }
    }
    let url = preview
        .url
        .clone()
        .ok_or_else(|| "Preview is still starting; URL not detected yet.".to_string())?;
    let label = format!("looper-preview-{}", request.loop_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .navigate(
                url.parse()
                    .map_err(|e| format!("invalid preview URL: {e}"))?,
            )
            .map_err(|e| format!("failed to navigate preview window: {e}"))?;
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(preview);
    }

    let parsed = url
        .parse()
        .map_err(|e| format!("invalid preview URL: {e}"))?;
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("Looper Preview")
        .inner_size(1280.0, 900.0)
        .build()
        .map_err(|e| format!("failed to build preview window: {e}"))?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(preview)
}

#[cfg(feature = "tauri-runtime")]
async fn preview_url_ready(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .get(url)
        .send()
        .await
        .map(|response| response.status().is_success() || response.status().is_redirection())
        .unwrap_or(false)
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
async fn cmd_workspace_tool_set_icon(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolSetIconRequest,
) -> Result<WorkspaceToolSetIconResponse, String> {
    state
        .workspace_tools
        .set_icon(request.tool_id.as_str(), request.icon)
        .map_err(|e| e.to_string())?;
    Ok(WorkspaceToolSetIconResponse {
        correlation_id: request.correlation_id,
        tool_id: request.tool_id,
        icon: request.icon,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_workspace_tool_forget(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolForgetRequest,
) -> Result<WorkspaceToolForgetResponse, String> {
    state
        .workspace_tools
        .forget_tool(request.tool_id.as_str())
        .map_err(|e| e.to_string())?;
    Ok(WorkspaceToolForgetResponse {
        correlation_id: request.correlation_id,
        tool_id: request.tool_id,
        forgotten: true,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_workspace_tool_create_app_plugin(
    state: State<'_, TauriBridgeState>,
    request: WorkspaceToolCreateAppPluginRequest,
) -> Result<WorkspaceToolCreateAppPluginResponse, String> {
    let tool = state.workspace_tools.create_app_tool_plugin(
        request.tool_id.as_str(),
        request.name.as_str(),
        request.icon.as_str(),
        request.description.as_str(),
    )?;
    Ok(WorkspaceToolCreateAppPluginResponse {
        correlation_id: request.correlation_id,
        tool,
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
async fn cmd_user_projects_roots(
    state: State<'_, TauriBridgeState>,
    request: UserProjectsRootsRequest,
) -> Result<UserProjectsRootsResponse, String> {
    let roots = state.user_projects.ensure_roots()?;
    Ok(UserProjectsRootsResponse {
        correlation_id: request.correlation_id,
        content_root: arxell_lite::app::user_projects_service::path_to_string(&roots.content_root),
        projects_root: arxell_lite::app::user_projects_service::path_to_string(
            &roots.projects_root,
        ),
        tools_root: arxell_lite::app::user_projects_service::path_to_string(&roots.tools_root),
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_user_project_ensure(
    state: State<'_, TauriBridgeState>,
    request: UserProjectEnsureRequest,
) -> Result<UserProjectEnsureResponse, String> {
    let project = state.user_projects.ensure_project(&request.project_name)?;
    Ok(UserProjectEnsureResponse {
        correlation_id: request.correlation_id,
        project_name: project.project_name,
        project_slug: project.project_slug,
        root_path: arxell_lite::app::user_projects_service::path_to_string(&project.root_path),
        tasks_path: arxell_lite::app::user_projects_service::path_to_string(&project.tasks_path),
        sheets_path: arxell_lite::app::user_projects_service::path_to_string(&project.sheets_path),
        looper_path: arxell_lite::app::user_projects_service::path_to_string(&project.looper_path),
        files_path: arxell_lite::app::user_projects_service::path_to_string(&project.files_path),
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
async fn cmd_api_connections_export(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionsExportRequest,
) -> Result<ApiConnectionsExportResponse, String> {
    let payload_json = state.api_registry.export_portable_snapshot_json()?;
    Ok(ApiConnectionsExportResponse {
        correlation_id: request.correlation_id,
        file_name: "arxell-api-connections.json".to_string(),
        payload_json,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating parent directories: {e}"))?;
    }
    std::fs::write(path, contents.as_bytes()).map_err(|e| format!("failed writing file: {e}"))
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connections_import(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionsImportRequest,
) -> Result<ApiConnectionsImportResponse, String> {
    let connections = state.api_registry.import_portable_snapshot_json(
        request.payload_json.as_str(),
        request.allow_plaintext_fallback,
    )?;
    Ok(ApiConnectionsImportResponse {
        correlation_id: request.correlation_id,
        connections,
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
        .create_and_verify(arxell_lite::api_registry::NewApiConnectionInput {
            api_type: request.api_type,
            api_url: request.api_url,
            name: request.name,
            api_key: request.api_key,
            model_name: request.model_name,
            cost_per_month_usd: request.cost_per_month_usd,
            api_standard_path: request.api_standard_path,
            allow_plaintext_fallback: request.allow_plaintext_fallback,
        })
        .await?;
    Ok(ApiConnectionCreateResponse {
        correlation_id: request.correlation_id,
        connection,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_api_connection_probe(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionProbeRequest,
) -> Result<ApiConnectionProbeResponse, String> {
    let probe = state
        .api_registry
        .probe_endpoint(
            request.api_url.as_str(),
            request.api_type,
            request.api_key.as_deref(),
            request.api_standard_path.as_deref(),
        )
        .await?;
    Ok(ApiConnectionProbeResponse {
        correlation_id: request.correlation_id,
        detected_api_type: probe.detected_api_type,
        api_standard_path: probe.api_standard_path,
        verify_url: probe.verify_url,
        models: probe.models,
        selected_model: probe.selected_model,
        status: probe.status,
        status_message: probe.status_message,
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
        arxell_lite::api_registry::UpdateApiConnectionInput {
            api_type: request.api_type,
            api_url: request.api_url,
            name: request.name,
            api_key: request.api_key,
            model_name: request.model_name,
            cost_per_month_usd: request.cost_per_month_usd,
            api_standard_path: request.api_standard_path,
            allow_plaintext_fallback: request.allow_plaintext_fallback,
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
async fn cmd_web_search(
    state: State<'_, TauriBridgeState>,
    request: WebSearchRequest,
) -> Result<WebSearchResponse, String> {
    // Compatibility wrapper retained for external callers still using cmd_web_search.
    // Canonical path is cmd_tool_invoke with toolId=webSearch, action=search.
    let correlation_id = request.correlation_id.clone();
    invoke_legacy_tool_command(
        &state,
        correlation_id.as_str(),
        "cmd_web_search",
        "webSearch",
        "search",
        &request,
    )
    .await
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
async fn cmd_app_resource_usage(
    request: AppResourceUsageRequest,
    state: State<'_, AppResourceUsageState>,
) -> Result<AppResourceUsageResponse, String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "app resource usage lock poisoned".to_string())?;
    let pid = sysinfo::Pid::from_u32(std::process::id());

    guard.system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );
    guard.networks.refresh(true);

    let process = guard.system.process(pid);
    let cpu_percent = process.map(|proc| proc.cpu_usage());
    let memory_bytes = process.map(|proc| proc.memory());

    let total_rx: u64 = guard
        .networks
        .values()
        .map(|entry| entry.total_received())
        .sum();
    let total_tx: u64 = guard
        .networks
        .values()
        .map(|entry| entry.total_transmitted())
        .sum();
    let now = Instant::now();
    let (network_rx_bytes_per_sec, network_tx_bytes_per_sec) =
        if let Some((last_at, last_rx, last_tx)) = guard.last_network_sample {
            let elapsed_sec = now.saturating_duration_since(last_at).as_secs_f64();
            if elapsed_sec > 0.0 {
                (
                    Some(((total_rx.saturating_sub(last_rx)) as f64 / elapsed_sec) as u64),
                    Some(((total_tx.saturating_sub(last_tx)) as f64 / elapsed_sec) as u64),
                )
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };
    guard.last_network_sample = Some((now, total_rx, total_tx));

    Ok(AppResourceUsageResponse {
        correlation_id: request.correlation_id,
        cpu_percent,
        memory_bytes,
        network_rx_bytes_per_sec,
        network_tx_bytes_per_sec,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_llama_runtime_status(
    app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: LlamaRuntimeStatusRequest,
) -> Result<LlamaRuntimeStatusResponse, String> {
    let app_data = app_paths::app_data_dir();
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
    let app_data = app_paths::app_data_dir();
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
    _app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: LlamaRuntimeStartRequest,
) -> Result<LlamaRuntimeStartResponse, String> {
    let app_data = app_paths::app_data_dir();
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
    _app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerListInstalledRequest,
) -> Result<ModelManagerListInstalledResponse, String> {
    let app_data = app_paths::app_data_dir();
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
    _app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerDownloadHfRequest,
) -> Result<ModelManagerDownloadHfResponse, String> {
    let app_data = app_paths::app_data_dir();
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
async fn cmd_model_manager_cancel_download(
    state: State<'_, TauriBridgeState>,
    request: ModelManagerCancelDownloadRequest,
) -> Result<ModelManagerCancelDownloadResponse, String> {
    let service = std::sync::Arc::clone(&state.model_manager);
    let cancelled = service.cancel_download(request.target_correlation_id.as_str());
    Ok(ModelManagerCancelDownloadResponse {
        correlation_id: request.correlation_id,
        target_correlation_id: request.target_correlation_id,
        cancelled,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_model_manager_delete_installed(
    _app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerDeleteInstalledRequest,
) -> Result<ModelManagerDeleteInstalledResponse, String> {
    let app_data = app_paths::app_data_dir();
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
#[tauri::command]
async fn cmd_model_manager_refresh_unsloth_catalog(
    _app: tauri::AppHandle,
    state: State<'_, TauriBridgeState>,
    request: ModelManagerRefreshUnslothCatalogRequest,
) -> Result<ModelManagerRefreshUnslothCatalogResponse, String> {
    let app_data = app_paths::app_data_dir();
    let service = std::sync::Arc::clone(&state.model_manager);
    let correlation_id = request.correlation_id.clone();
    let app_data_owned = app_data.clone();
    let (rows, new_count) = tokio::task::spawn_blocking(move || {
        service.refresh_unsloth_ud_catalog(correlation_id.as_str(), app_data_owned.as_path())
    })
    .await
    .map_err(|e| format!("model manager refresh unsloth catalog task failed: {e}"))??;
    Ok(ModelManagerRefreshUnslothCatalogResponse {
        correlation_id: request.correlation_id,
        rows,
        new_count,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_tool_invoke(
    state: State<'_, TauriBridgeState>,
    request: ToolInvokeRequest,
) -> Result<ToolInvokeResponse, String> {
    invoke_tool(&state, request).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_custom_tool_capability_invoke(
    state: State<'_, TauriBridgeState>,
    request: CustomToolCapabilityInvokeRequest,
) -> Result<CustomToolCapabilityInvokeResponse, String> {
    handle_custom_tool_capability_invoke(&state, &request)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_plugin_capability_invoke(
    state: State<'_, TauriBridgeState>,
    request: PluginCapabilityInvokeRequest,
) -> Result<PluginCapabilityInvokeResponse, String> {
    let bridged = CustomToolCapabilityInvokeRequest {
        correlation_id: request.correlation_id,
        custom_tool_id: request.plugin_id,
        request_id: request.request_id,
        capability: request.capability,
        payload: request.payload,
    };
    let response = handle_custom_tool_capability_invoke(&state, &bridged)?;
    Ok(PluginCapabilityInvokeResponse {
        correlation_id: response.correlation_id,
        plugin_id: response.custom_tool_id,
        request_id: response.request_id,
        capability: response.capability,
        ok: response.ok,
        data: response.data,
        error: response.error,
        code: response.code,
    })
}

#[cfg(feature = "tauri-runtime")]
fn handle_custom_tool_capability_invoke(
    state: &TauriBridgeState,
    request: &CustomToolCapabilityInvokeRequest,
) -> Result<CustomToolCapabilityInvokeResponse, String> {
    state.hub.emit(state.hub.make_event(
        request.correlation_id.as_str(),
        Subsystem::Ipc,
        "custom_tool.capability.invoke",
        EventStage::Start,
        EventSeverity::Info,
        json!({
            "customToolId": request.custom_tool_id,
            "pluginId": request.custom_tool_id,
            "requestId": request.request_id,
            "capability": request.capability
        }),
    ));

    if let Err(code) = state
        .workspace_tools
        .ensure_custom_tool_capability(request.custom_tool_id.as_str(), request.capability.as_str())
    {
        let response = custom_tool_capability_error(
            &request,
            code.as_str(),
            format!(
                "Custom tool capability denied: {} for {}",
                request.capability, request.custom_tool_id
            ),
        );
        state.hub.emit(state.hub.make_event(
            request.correlation_id.as_str(),
            Subsystem::Ipc,
            "custom_tool.capability.invoke",
            EventStage::Error,
            EventSeverity::Warn,
            json!({
                "customToolId": request.custom_tool_id,
                "pluginId": request.custom_tool_id,
                "requestId": request.request_id,
                "capability": request.capability,
                "code": response.code,
                "error": response.error
            }),
        ));
        return Ok(response);
    }

    let result = invoke_custom_tool_capability(&state, &request);
    let response = match result {
        Ok(data) => CustomToolCapabilityInvokeResponse {
            correlation_id: request.correlation_id.clone(),
            custom_tool_id: request.custom_tool_id.clone(),
            request_id: request.request_id.clone(),
            capability: request.capability.clone(),
            ok: true,
            data,
            error: None,
            code: None,
        },
        Err((code, message)) => custom_tool_capability_error(&request, code, message),
    };

    state.hub.emit(state.hub.make_event(
        request.correlation_id.as_str(),
        Subsystem::Ipc,
        "custom_tool.capability.invoke",
        if response.ok {
            EventStage::Complete
        } else {
            EventStage::Error
        },
        if response.ok {
            EventSeverity::Info
        } else {
            EventSeverity::Warn
        },
        json!({
            "customToolId": request.custom_tool_id,
            "pluginId": request.custom_tool_id,
            "requestId": request.request_id,
            "capability": request.capability,
            "ok": response.ok,
            "code": response.code,
            "error": response.error
        }),
    ));
    Ok(response)
}

#[cfg(feature = "tauri-runtime")]
fn custom_tool_capability_error(
    request: &CustomToolCapabilityInvokeRequest,
    code: &str,
    message: String,
) -> CustomToolCapabilityInvokeResponse {
    CustomToolCapabilityInvokeResponse {
        correlation_id: request.correlation_id.clone(),
        custom_tool_id: request.custom_tool_id.clone(),
        request_id: request.request_id.clone(),
        capability: request.capability.clone(),
        ok: false,
        data: json!({}),
        error: Some(message),
        code: Some(code.to_string()),
    }
}

#[cfg(feature = "tauri-runtime")]
fn invoke_custom_tool_capability(
    state: &TauriBridgeState,
    request: &CustomToolCapabilityInvokeRequest,
) -> Result<Value, (&'static str, String)> {
    match request.capability.as_str() {
        "files.read" => {
            let action = request
                .payload
                .get("action")
                .and_then(|value| value.as_str())
                .unwrap_or("list-directory");
            match action {
                "list-directory" | "listDirectory" => {
                    let path = request
                        .payload
                        .get("path")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string());
                    let response = state
                        .files
                        .list_directory(path.as_deref(), request.correlation_id.clone())
                        .map_err(|e| ("files_read_failed", e))?;
                    serde_json::to_value(response).map_err(|e| {
                        (
                            "serialization_failed",
                            format!("failed serializing result: {e}"),
                        )
                    })
                }
                "read-file" | "readFile" => {
                    let Some(path) = request.payload.get("path").and_then(|value| value.as_str())
                    else {
                        return Err((
                            "invalid_payload",
                            "files.read read-file requires payload.path".to_string(),
                        ));
                    };
                    let response = state
                        .files
                        .read_file(path, request.correlation_id.clone())
                        .map_err(|e| ("files_read_failed", e))?;
                    serde_json::to_value(response).map_err(|e| {
                        (
                            "serialization_failed",
                            format!("failed serializing result: {e}"),
                        )
                    })
                }
                _ => Err((
                    "invalid_action",
                    format!("Unsupported files.read action: {action}"),
                )),
            }
        }
        "tasks.read" => Err((
            "capability_unavailable",
            "tasks.read is not yet available in host runtime.".to_string(),
        )),
        _ => Err((
            "capability_unknown",
            format!("Unsupported custom tool capability: {}", request.capability),
        )),
    }
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
async fn cmd_files_list_directory(
    state: State<'_, TauriBridgeState>,
    request: FilesListDirectoryRequest,
) -> Result<FilesListDirectoryResponse, String> {
    // Compatibility wrapper retained for external callers still using cmd_files_list_directory.
    // Canonical path is cmd_tool_invoke with toolId=files, action=list-directory.
    let correlation_id = request.correlation_id.clone();
    invoke_legacy_tool_command(
        &state,
        correlation_id.as_str(),
        "cmd_files_list_directory",
        "files",
        "list-directory",
        &request,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
fn resolve_bundled_engine_binary(app: &tauri::AppHandle, engine_id: &str) -> Option<PathBuf> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let binary_name = arxell_lite::app::runtime_service::engine_binary_filename();
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
fn window_state_path(_handle: &tauri::AppHandle) -> PathBuf {
    let base = app_paths::app_data_dir();
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
