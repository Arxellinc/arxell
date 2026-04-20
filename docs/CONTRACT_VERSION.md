# Contract Version

## Current Version
- `foundation-v5`

## Scope
This version pins the shared contracts between the TypeScript frontend (`frontend/src/contracts.ts`) and the Rust backend (`src-tauri/src/contracts.rs`).

### Chat
- command: `cmd_chat_send_message` → `ChatSendRequest` / `ChatSendResponse`
- command: `cmd_chat_cancel_message` → `ChatCancelRequest` / `ChatCancelResponse`
- command: `cmd_chat_get_messages` → `ChatGetMessagesRequest` / `ChatGetMessagesResponse`
- command: `cmd_chat_list_conversations` → `ChatListConversationsRequest` / `ChatListConversationsResponse`
- command: `cmd_chat_delete_conversation` → `ChatDeleteConversationRequest` / `ChatDeleteConversationResponse`

### Terminal
- command: `cmd_terminal_open_session` → `TerminalOpenSessionRequest` / `TerminalOpenSessionResponse`
- command: `cmd_terminal_send_input` → `TerminalInputRequest` / `TerminalInputResponse`
- command: `cmd_terminal_resize` → `TerminalResizeRequest` / `TerminalResizeResponse`
- command: `cmd_terminal_close_session` → `TerminalCloseSessionRequest` / `TerminalCloseSessionResponse`

### Workspace Tools
- command: `cmd_workspace_tools_list` → `WorkspaceToolsListRequest` / `WorkspaceToolsListResponse`
- command: `cmd_workspace_tool_set_enabled` → `WorkspaceToolSetEnabledRequest` / `WorkspaceToolSetEnabledResponse`
- command: `cmd_workspace_tool_set_icon` → `WorkspaceToolSetIconRequest` / `WorkspaceToolSetIconResponse`
- command: `cmd_workspace_tool_forget` → `WorkspaceToolForgetRequest` / `WorkspaceToolForgetResponse`
- command: `cmd_workspace_tool_create_app_plugin` → `WorkspaceToolCreateAppPluginRequest` / `WorkspaceToolCreateAppPluginResponse`
- command: `cmd_workspace_tools_export` → `WorkspaceToolsExportRequest` / `WorkspaceToolsExportResponse`
- command: `cmd_workspace_tools_import` → `WorkspaceToolsImportRequest` / `WorkspaceToolsImportResponse`

### Tool Invoke
- command: `cmd_tool_invoke` → `ToolInvokeRequest` / `ToolInvokeResponse`
- command: `cmd_custom_tool_capability_invoke` → `CustomToolCapabilityInvokeRequest` / `CustomToolCapabilityInvokeResponse`
- command: `cmd_plugin_capability_invoke` → `PluginCapabilityInvokeRequest` / `PluginCapabilityInvokeResponse`

### API Connections
- command: `cmd_api_connections_list` → `ApiConnectionsListRequest` / `ApiConnectionsListResponse`
- command: `cmd_api_connections_export` → `ApiConnectionsExportRequest` / `ApiConnectionsExportResponse`
- command: `cmd_api_connections_import` → `ApiConnectionsImportRequest` / `ApiConnectionsImportResponse`
- command: `cmd_api_connection_create` → `ApiConnectionCreateRequest` / `ApiConnectionCreateResponse`
- command: `cmd_api_connection_probe` → `ApiConnectionProbeRequest` / `ApiConnectionProbeResponse`
- command: `cmd_api_connection_update` → `ApiConnectionUpdateRequest` / `ApiConnectionUpdateResponse`
- command: `cmd_api_connection_reverify` → `ApiConnectionReverifyRequest` / `ApiConnectionReverifyResponse`
- command: `cmd_api_connection_delete` → `ApiConnectionDeleteRequest` / `ApiConnectionDeleteResponse`
- command: `cmd_api_connection_get_secret` → `ApiConnectionGetSecretRequest` / `ApiConnectionGetSecretResponse`

### Web Search
- command: `cmd_web_search` → `WebSearchRequest` / `WebSearchResponse`

### Files
- command: `cmd_files_list_directory` → `FilesListDirectoryRequest` / `FilesListDirectoryResponse`
- invoke actions: `read-file`, `write-file`, `create-directory`, `delete-path` (via `cmd_tool_invoke`)

### LLaMA Runtime
- command: `cmd_llama_runtime_status` → `LlamaRuntimeStatusRequest` / `LlamaRuntimeStatusResponse`
- command: `cmd_llama_runtime_install_engine` → `LlamaRuntimeInstallRequest` / `LlamaRuntimeInstallResponse`
- command: `cmd_llama_runtime_start` → `LlamaRuntimeStartRequest` / `LlamaRuntimeStartResponse`
- command: `cmd_llama_runtime_stop` → `LlamaRuntimeStopRequest` / `LlamaRuntimeStopResponse`

### Model Manager
- command: `cmd_model_manager_list_installed` → `ModelManagerListInstalledRequest` / `ModelManagerListInstalledResponse`
- command: `cmd_model_manager_search_hf` → `ModelManagerSearchHfRequest` / `ModelManagerSearchHfResponse`
- command: `cmd_model_manager_download_hf` → `ModelManagerDownloadHfRequest` / `ModelManagerDownloadHfResponse`
- command: `cmd_model_manager_delete_installed` → `ModelManagerDeleteInstalledRequest` / `ModelManagerDeleteInstalledResponse`
- command: `cmd_model_manager_list_catalog_csv` → `ModelManagerListCatalogCsvRequest` / `ModelManagerListCatalogCsvResponse`

### Devices
- command: `cmd_devices_probe_microphone` → `DevicesProbeMicrophoneRequest` / `DevicesProbeMicrophoneResponse`

### App Meta
- command: `cmd_app_version` → `AppVersionResponse`
- command: `cmd_app_resource_usage` → `AppResourceUsageRequest` / `AppResourceUsageResponse`

### Flow
- command: `cmd_flow_start` → `FlowStartRequest` / `FlowStartResponse`
- command: `cmd_flow_stop` → `FlowStopRequest` / `FlowStopResponse`
- command: `cmd_flow_status` → `FlowStatusRequest` / `FlowStatusResponse`
- command: `cmd_flow_list_runs` → `FlowListRunsRequest` / `FlowListRunsResponse`
- command: `cmd_flow_rerun_validation` → `FlowRerunValidationRequest` / `FlowRerunValidationResponse`
- invoke actions: `pause`, `nudge` (via `cmd_tool_invoke`)

### Looper (via `cmd_tool_invoke`)
- invoke actions: `start`, `stop`, `pause`, `advance`, `status`, `list`, `close`, `check-opencode`, `submit-questions`
- contracts: `LooperStartRequest/Response`, `LooperStopRequest/Response`, `LooperPauseRequest/Response`, `LooperAdvanceRequest/Response`, `LooperStatusRequest/Response`, `LooperListRequest/Response`, `LooperCloseRequest/Response`, `LooperCheckOpenCodeRequest/Response`, `LooperSubmitQuestionsRequest/Response`

### STT
- command: `start_stt`
- command: `stop_stt`
- command: `stt_status`
- command: `stt_set_backend`
- command: `stt_get_backend`
- command: `stt_set_model`
- command: `stt_set_language`
- command: `stt_set_threads`
- command: `stt_download_model`
- command: `stt_list_models`
- command: `transcribe_chunk`
- command: `transcribe_partial_chunk`
- command: `stt_stream_reset`
- command: `stt_stream_ingest`

### TTS
- command: `cmd_tts_status` → `TtsStatusRequest` / `TtsStatusResponse`
- command: `cmd_tts_list_voices` → `TtsListVoicesRequest` / `TtsListVoicesResponse`
- command: `cmd_tts_speak` → `TtsSpeakRequest` / `TtsSpeakResponse`
- command: `cmd_tts_stop` → `TtsStopRequest` / `TtsStopResponse`
- command: `cmd_tts_self_test` → `TtsSelfTestRequest` / `TtsSelfTestResponse`
- command: `cmd_tts_settings_get` → `TtsSettingsGetRequest` / `TtsSettingsGetResponse`
- command: `cmd_tts_settings_set` → `TtsSettingsSetRequest` / `TtsSettingsSetResponse`
- command: `cmd_tts_download_model` → `TtsDownloadModelRequest` / `TtsDownloadModelResponse`

### Voice / VAD
- command: `cmd_voice_list_vad_methods` → `VoiceListVadMethodsRequest` / `VoiceListVadMethodsResponse`
- command: `cmd_voice_get_vad_settings` → `VoiceGetVadSettingsRequest` / `VoiceGetVadSettingsResponse`
- command: `cmd_voice_set_vad_method` → `VoiceSetVadMethodRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_update_vad_config` → `VoiceUpdateVadConfigRequest` / `VoiceUpdateVadConfigResponse`
- command: `cmd_voice_start_session` → `VoiceStartSessionRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_stop_session` → `VoiceStopSessionRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_request_handoff` → `VoiceRequestHandoffRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_set_shadow_method` → `VoiceSetShadowMethodRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_start_shadow_eval` → `VoiceStartShadowEvalRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_stop_shadow_eval` → `VoiceStopShadowEvalRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_set_duplex_mode` → `VoiceSetDuplexModeRequest` / `VoiceRuntimeSnapshotResponse`
- command: `cmd_voice_get_runtime_diagnostics` → `VoiceGetRuntimeDiagnosticsRequest` / `VoiceRuntimeSnapshotResponse`

### Event Channel
- `app:event` → `AppEvent`

### Streaming Actions
- `chat.stream.start` → `ChatStreamStartPayload`
- `chat.stream.chunk` → `ChatStreamChunkPayload`
- `chat.stream.reasoning_chunk` → `ChatStreamReasoningChunkPayload`
- `chat.stream.complete` → `ChatStreamCompletePayload`
- `chat.stream.error`
- `terminal.output`
- `flow.run.start`
- `flow.run.complete`
- `flow.iteration.start`
- `flow.iteration.complete`
- `model.manager.list_installed`
- `model.manager.search_hf`
- `model.manager.download_hf`
- `model.manager.delete_installed`
- `conversation.append`
- `conversation.list`

## Contract Files
| Layer | File | Lines |
|-------|------|-------|
| Frontend (TS) | `frontend/src/contracts.ts` | ~1324 |
| Backend (Rust) | `src-tauri/src/contracts.rs` | ~1730 |
| Voice handoff | `src-tauri/src/voice/handoff/contracts.rs` | — |
| Voice speculation | `src-tauri/src/voice/speculation/contracts.rs` | — |
| Voice VAD | `src-tauri/src/voice/vad/contracts.rs` | — |

## Compatibility Rule
- Any command, field, action, or payload shape change must:
  1. bump contract version (`foundation-v5` → `foundation-v6`, etc.)
  2. update `IPC_EVENTS.md`
  3. document migration impact in PR/changeset

## Correlation Rule
`correlationId` must remain identical from request to all related events and final response.

## Version History
| Version | Changes |
|---------|---------|
| `foundation-v1` | Initial chat commands and streaming |
| `foundation-v2` | Model manager commands |
| `foundation-v3` | Streaming action expansion |
| `foundation-v4` | Event channel, persistence actions |
| `foundation-v5` | Terminal, workspace tools, API connections, files, llama runtime, flow, looper, STT, TTS, voice/VAD, devices, app meta, catalog CSV, tool invoke, custom tool/plugin capabilities, reasoning chunk streaming |
