# Tauri Integration Guide

This project uses **Tauri v2** with a feature-gated bridge in Rust.

## Feature
Enable with:
- `cargo run --features tauri-runtime`
- or for checks: `cargo check --features tauri-runtime`

## Bridge State

`TauriBridgeState` (in `src-tauri/src/ipc/tauri_bridge.rs`) holds managed state:
- `chat: Arc<ChatCommandHandler>`
- `terminal: Arc<TerminalCommandHandler>`
- `looper_handler: Arc<LooperCommandHandler>`
- `voice_handler: Arc<VoiceCommandHandler>`
- `hub: EventHub`
- `workspace_tools: Arc<WorkspaceToolsService>`
- `api_registry: Arc<ApiRegistryService>`
- `web_search: Arc<WebSearchService>`
- `runtime: Arc<LlamaRuntimeService>`
- `permissions: Arc<PermissionService>`
- `model_manager: Arc<ModelManagerService>`
- `files: Arc<FilesService>`
- `sheets: Arc<SheetsService>`
- `user_projects: Arc<UserProjectsService>`
- `voice: Arc<VoiceRuntimeService>`

Additional managed state (in `main.rs`):
- `STTState` — STT backend state
- `TTSState` — TTS engine state
- `AppResourceUsageState` — resource monitoring

## Registered Commands

All commands are registered via `tauri::generate_handler!` in `src-tauri/src/main.rs`.

### Chat
- `cmd_chat_send_message`
- `cmd_chat_cancel_message`
- `cmd_chat_delete_conversation`
- `cmd_chat_get_messages`
- `cmd_chat_list_conversations`

### Terminal
- `cmd_terminal_open_session`
- `cmd_terminal_send_input`
- `cmd_terminal_resize`
- `cmd_terminal_close_session`

### Workspace Tools
- `cmd_workspace_tools_list`
- `cmd_workspace_tool_set_enabled`
- `cmd_workspace_tool_set_icon`
- `cmd_workspace_tool_forget`
- `cmd_workspace_tool_create_app_plugin`
- `cmd_workspace_tools_export`
- `cmd_workspace_tools_import`

### Tool Invoke
- `cmd_tool_invoke`
- `cmd_custom_tool_capability_invoke`
- `cmd_plugin_capability_invoke`

### API Connections
- `cmd_api_connections_list`
- `cmd_api_connections_export`
- `cmd_api_connections_import`
- `cmd_api_connection_create`
- `cmd_api_connection_probe`
- `cmd_api_connection_update`
- `cmd_api_connection_reverify`
- `cmd_api_connection_delete`

### Search & Files
- `cmd_web_search`
- `cmd_files_list_directory`

### LLaMA Runtime
- `cmd_llama_runtime_status`
- `cmd_llama_runtime_install_engine`
- `cmd_llama_runtime_start`
- `cmd_llama_runtime_stop`

### Model Manager
- `cmd_model_manager_list_installed`
- `cmd_model_manager_search_hf`
- `cmd_model_manager_download_hf`
- `cmd_model_manager_delete_installed`
- `cmd_model_manager_list_catalog_csv`

### Devices & App Meta
- `cmd_devices_probe_microphone`
- `cmd_app_version`
- `cmd_app_resource_usage`

### STT
- `start_stt`
- `stop_stt`
- `stt_status`
- `stt_set_backend`
- `stt_get_backend`
- `stt_set_model`
- `stt_set_language`
- `stt_set_threads`
- `stt_download_model`
- `stt_list_models`
- `transcribe_chunk`
- `transcribe_partial_chunk`
- `stt_stream_reset`
- `stt_stream_ingest`

### TTS
- `cmd_tts_status`
- `cmd_tts_list_voices`
- `cmd_tts_speak`
- `cmd_tts_stop`
- `cmd_tts_self_test`
- `cmd_tts_settings_get`
- `cmd_tts_settings_set`
- `cmd_tts_download_model`

### Voice / VAD
- `cmd_voice_list_vad_methods`
- `cmd_voice_get_vad_settings`
- `cmd_voice_set_vad_method`
- `cmd_voice_update_vad_config`
- `cmd_voice_start_session`
- `cmd_voice_stop_session`
- `cmd_voice_request_handoff`
- `cmd_voice_set_shadow_method`
- `cmd_voice_start_shadow_eval`
- `cmd_voice_stop_shadow_eval`
- `cmd_voice_set_duplex_mode`
- `cmd_voice_get_runtime_diagnostics`

## App Setup Requirements in a Tauri Entry Point
1. Create `AppContext` with all services.
2. Attach event forwarder:
   - `attach_event_forwarder(app.handle().clone(), app_context.ipc.event_hub())`
3. Manage bridge state and auxiliary state:
    - `TauriBridgeState { chat, terminal, looper_handler, voice_handler, hub, workspace_tools, api_registry, web_search, runtime, user_projects, permissions, model_manager, files, sheets, voice }`
   - `STTState::new()`
   - `TTSState::new()`
   - `AppResourceUsageState::new()`
4. Register all command handlers via `tauri::generate_handler![...]` (see list above).

## Event Guarantees
- Correlation ID preserved across command + stream events.
- All events emitted through `EventHub` and forwarded to `app:event` on the Tauri app handle.
- Streaming actions include:
  - `chat.stream.start`, `chat.stream.chunk`, `chat.stream.reasoning_chunk`, `chat.stream.complete`, `chat.stream.error`
  - `terminal.output`
  - `model.manager.*`
  - `conversation.*`

## Event Forwarder
The event forwarder (`attach_event_forwarder`) subscribes to the `EventHub` broadcast channel and re-emits every `AppEvent` as a Tauri `app:event` payload. This is how the frontend receives real-time updates via the `onEvent` listener in `ipcClient.ts`.
