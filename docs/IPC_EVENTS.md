# IPC and Event Contracts

Contract version: `foundation-v5` (see `CONTRACT_VERSION.md`)

## Event Channel
- `app:event`
  - payload: `AppEvent` (see below)

### AppEvent Structure
| Field | Type | Description |
|-------|------|-------------|
| `timestampMs` | `number` | Epoch millis |
| `correlationId` | `string` | Request correlation |
| `subsystem` | `Subsystem` | `frontend`, `ipc`, `service`, `runtime`, `registry`, `tool`, `memory`, `persistence` |
| `action` | `string` | Action identifier |
| `stage` | `EventStage` | `start`, `progress`, `complete`, `error` |
| `severity` | `EventSeverity` | `debug`, `info`, `warn`, `error` |
| `payload` | `Record<string, unknown> \| string \| number \| boolean \| null` | Action-specific data |

---

## Chat Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_chat_send_message` | `ChatSendRequest` | `ChatSendResponse` |
| `cmd_chat_cancel_message` | `ChatCancelRequest` | `ChatCancelResponse` |
| `cmd_chat_get_messages` | `ChatGetMessagesRequest` | `ChatGetMessagesResponse` |
| `cmd_chat_list_conversations` | `ChatListConversationsRequest` | `ChatListConversationsResponse` |
| `cmd_chat_delete_conversation` | `ChatDeleteConversationRequest` | `ChatDeleteConversationResponse` |

### Chat Streaming Actions
- `chat.stream.start`
  - stage: `start`
  - payload: `ChatStreamStartPayload { conversationId }`
- `chat.stream.chunk`
  - stage: `progress`
  - payload: `ChatStreamChunkPayload { conversationId, delta, done }`
- `chat.stream.reasoning_chunk`
  - stage: `progress`
  - payload: `ChatStreamReasoningChunkPayload { conversationId, delta, done }`
- `chat.stream.complete`
  - stage: `complete`
  - payload: `ChatStreamCompletePayload { conversationId, assistantLength }`
- `chat.stream.error`
  - stage: `error`
  - payload: `{ message }`

### Persistence Actions
- `conversation.append`
  - stage: `start|complete|error`
  - payload: append status/error details
- `conversation.list`
  - stage: `error`
  - payload: list read error details

---

## Terminal Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_terminal_open_session` | `TerminalOpenSessionRequest` | `TerminalOpenSessionResponse` |
| `cmd_terminal_send_input` | `TerminalInputRequest` | `TerminalInputResponse` |
| `cmd_terminal_resize` | `TerminalResizeRequest` | `TerminalResizeResponse` |
| `cmd_terminal_close_session` | `TerminalCloseSessionRequest` | `TerminalCloseSessionResponse` |

### Terminal Streaming Actions
- `terminal.output`
  - stage: `progress`
  - payload: `{ sessionId, data }`

---

## Workspace Tool Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_workspace_tools_list` | `WorkspaceToolsListRequest` | `WorkspaceToolsListResponse` |
| `cmd_workspace_tool_set_enabled` | `WorkspaceToolSetEnabledRequest` | `WorkspaceToolSetEnabledResponse` |
| `cmd_workspace_tool_set_icon` | `WorkspaceToolSetIconRequest` | `WorkspaceToolSetIconResponse` |
| `cmd_workspace_tool_forget` | `WorkspaceToolForgetRequest` | `WorkspaceToolForgetResponse` |
| `cmd_workspace_tool_create_app_plugin` | `WorkspaceToolCreateAppPluginRequest` | `WorkspaceToolCreateAppPluginResponse` |
| `cmd_workspace_tools_export` | `WorkspaceToolsExportRequest` | `WorkspaceToolsExportResponse` |
| `cmd_workspace_tools_import` | `WorkspaceToolsImportRequest` | `WorkspaceToolsImportResponse` |

---

## Tool Invoke Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_tool_invoke` | `ToolInvokeRequest` | `ToolInvokeResponse` |
| `cmd_custom_tool_capability_invoke` | `CustomToolCapabilityInvokeRequest` | `CustomToolCapabilityInvokeResponse` |
| `cmd_plugin_capability_invoke` | `PluginCapabilityInvokeRequest` | `PluginCapabilityInvokeResponse` |

`ToolInvokeRequest` is the generic gateway for tool-specific backend actions:
- `toolId`: `files`, `flow`, `looper`, `webSearch`, etc.
- `action`: tool-specific action string
- `mode`: `sandbox`, `shell`, or `root`
- `payload`: typed per tool/action

---

## API Connection Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_api_connections_list` | `ApiConnectionsListRequest` | `ApiConnectionsListResponse` |
| `cmd_api_connections_export` | `ApiConnectionsExportRequest` | `ApiConnectionsExportResponse` |
| `cmd_api_connections_import` | `ApiConnectionsImportRequest` | `ApiConnectionsImportResponse` |
| `cmd_api_connection_create` | `ApiConnectionCreateRequest` | `ApiConnectionCreateResponse` |
| `cmd_api_connection_probe` | `ApiConnectionProbeRequest` | `ApiConnectionProbeResponse` |
| `cmd_api_connection_update` | `ApiConnectionUpdateRequest` | `ApiConnectionUpdateResponse` |
| `cmd_api_connection_reverify` | `ApiConnectionReverifyRequest` | `ApiConnectionReverifyResponse` |
| `cmd_api_connection_delete` | `ApiConnectionDeleteRequest` | `ApiConnectionDeleteResponse` |
| `cmd_api_connection_get_secret` | `ApiConnectionGetSecretRequest` | `ApiConnectionGetSecretResponse` |

---

## Web Search Command

| Command | Input | Output |
|---------|-------|--------|
| `cmd_web_search` | `WebSearchRequest` | `WebSearchResponse` |

---

## Files Command

| Command | Input | Output |
|---------|-------|--------|
| `cmd_files_list_directory` | `FilesListDirectoryRequest` | `FilesListDirectoryResponse` |

Additional file operations via `cmd_tool_invoke` (`toolId: "files"`):
- `read-file` → `FilesReadFileRequest` / `FilesReadFileResponse`
- `write-file` → `FilesWriteFileRequest` / `FilesWriteFileResponse`
- `create-directory` → `FilesCreateDirectoryRequest` / `FilesCreateDirectoryResponse`
- `delete-path` → `FilesDeletePathRequest` / `FilesDeletePathResponse`

---

## LLaMA Runtime Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_llama_runtime_status` | `LlamaRuntimeStatusRequest` | `LlamaRuntimeStatusResponse` |
| `cmd_llama_runtime_install_engine` | `LlamaRuntimeInstallRequest` | `LlamaRuntimeInstallResponse` |
| `cmd_llama_runtime_start` | `LlamaRuntimeStartRequest` | `LlamaRuntimeStartResponse` |
| `cmd_llama_runtime_stop` | `LlamaRuntimeStopRequest` | `LlamaRuntimeStopResponse` |

---

## Model Manager Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_model_manager_list_installed` | `ModelManagerListInstalledRequest` | `ModelManagerListInstalledResponse` |
| `cmd_model_manager_search_hf` | `ModelManagerSearchHfRequest` | `ModelManagerSearchHfResponse` |
| `cmd_model_manager_download_hf` | `ModelManagerDownloadHfRequest` | `ModelManagerDownloadHfResponse` |
| `cmd_model_manager_delete_installed` | `ModelManagerDeleteInstalledRequest` | `ModelManagerDeleteInstalledResponse` |
| `cmd_model_manager_list_catalog_csv` | `ModelManagerListCatalogCsvRequest` | `ModelManagerListCatalogCsvResponse` |

### Model Manager Actions
- `model.manager.list_installed`
  - stage: `start|complete|error`
  - payload: `{ count? }` or error details
- `model.manager.search_hf`
  - stage: `start|complete|error`
  - payload: `{ query, count? }` or error details
- `model.manager.download_hf`
  - stage: `start|progress|complete|error`
  - payload: `{ repoId, fileName?, path?, sizeMb? }` or error details
- `model.manager.delete_installed`
  - stage: `start|complete|error`
  - payload: `{ modelId }` or error details

---

## Devices Command

| Command | Input | Output |
|---------|-------|--------|
| `cmd_devices_probe_microphone` | `DevicesProbeMicrophoneRequest` | `DevicesProbeMicrophoneResponse` |

---

## App Meta Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_app_version` | — | `AppVersionResponse` |
| `cmd_app_resource_usage` | `AppResourceUsageRequest` | `AppResourceUsageResponse` |

---

## Flow Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_flow_start` | `FlowStartRequest` | `FlowStartResponse` |
| `cmd_flow_stop` | `FlowStopRequest` | `FlowStopResponse` |
| `cmd_flow_status` | `FlowStatusRequest` | `FlowStatusResponse` |
| `cmd_flow_list_runs` | `FlowListRunsRequest` | `FlowListRunsResponse` |
| `cmd_flow_rerun_validation` | `FlowRerunValidationRequest` | `FlowRerunValidationResponse` |

Additional flow operations via `cmd_tool_invoke` (`toolId: "flow"`):
- `pause` / `set-paused` → `FlowPauseRequest` / `FlowPauseResponse`
- `nudge` / `redirect` → `FlowNudgeRequest` / `FlowNudgeResponse`

### Flow Streaming Actions
- `flow.run.start`
  - stage: `start`
  - payload: `{ runId, mode }`
- `flow.run.complete`
  - stage: `complete`
  - payload: `{ runId, stopped? }`
- `flow.iteration.start`
- `flow.iteration.complete`

---

## Looper Operations (via `cmd_tool_invoke`, `toolId: "looper"`)

| Action | Input | Output |
|--------|-------|--------|
| `start` | `LooperStartRequest` | `LooperStartResponse` |
| `stop` | `LooperStopRequest` | `LooperStopResponse` |
| `pause` | `LooperPauseRequest` | `LooperPauseResponse` |
| `advance` | `LooperAdvanceRequest` | `LooperAdvanceResponse` |
| `status` | `LooperStatusRequest` | `LooperStatusResponse` |
| `list` | `LooperListRequest` | `LooperListResponse` |
| `close` | `LooperCloseRequest` | `LooperCloseResponse` |
| `check-opencode` | `LooperCheckOpenCodeRequest` | `LooperCheckOpenCodeResponse` |
| `submit-questions` | `LooperSubmitQuestionsRequest` | `LooperSubmitQuestionsResponse` |

---

## STT Commands

| Command | Input | Output |
|---------|-------|--------|
| `start_stt` | — | `()` |
| `stop_stt` | — | `()` |
| `stt_status` | — | `STTStatusPayload` |
| `stt_set_backend` | `backend: String` | `String` |
| `stt_get_backend` | — | `String` |
| `stt_set_model` | `model: String` | `()` |
| `stt_set_language` | `language: String` | `()` |
| `stt_set_threads` | `threads: u32` | `()` |
| `stt_download_model` | — | `()` |
| `stt_list_models` | — | `Vec<String>` |
| `transcribe_chunk` | audio chunk | transcription result |
| `transcribe_partial_chunk` | audio chunk | partial transcription |
| `stt_stream_reset` | — | `()` |
| `stt_stream_ingest` | audio data | `()` |

---

## TTS Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_tts_status` | `TtsStatusRequest` | `TtsStatusResponse` |
| `cmd_tts_list_voices` | `TtsListVoicesRequest` | `TtsListVoicesResponse` |
| `cmd_tts_speak` | `TtsSpeakRequest` | `TtsSpeakResponse` |
| `cmd_tts_stop` | `TtsStopRequest` | `TtsStopResponse` |
| `cmd_tts_self_test` | `TtsSelfTestRequest` | `TtsSelfTestResponse` |
| `cmd_tts_settings_get` | `TtsSettingsGetRequest` | `TtsSettingsGetResponse` |
| `cmd_tts_settings_set` | `TtsSettingsSetRequest` | `TtsSettingsSetResponse` |
| `cmd_tts_download_model` | `TtsDownloadModelRequest` | `TtsDownloadModelResponse` |

---

## Voice / VAD Commands

| Command | Input | Output |
|---------|-------|--------|
| `cmd_voice_list_vad_methods` | `VoiceListVadMethodsRequest` | `VoiceListVadMethodsResponse` |
| `cmd_voice_get_vad_settings` | `VoiceGetVadSettingsRequest` | `VoiceGetVadSettingsResponse` |
| `cmd_voice_set_vad_method` | `VoiceSetVadMethodRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_update_vad_config` | `VoiceUpdateVadConfigRequest` | `VoiceUpdateVadConfigResponse` |
| `cmd_voice_start_session` | `VoiceStartSessionRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_stop_session` | `VoiceStopSessionRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_request_handoff` | `VoiceRequestHandoffRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_set_shadow_method` | `VoiceSetShadowMethodRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_start_shadow_eval` | `VoiceStartShadowEvalRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_stop_shadow_eval` | `VoiceStopShadowEvalRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_set_duplex_mode` | `VoiceSetDuplexModeRequest` | `VoiceRuntimeSnapshotResponse` |
| `cmd_voice_get_runtime_diagnostics` | `VoiceGetRuntimeDiagnosticsRequest` | `VoiceRuntimeSnapshotResponse` |

### Voice Runtime States
- `VoiceRuntimeState`: `idle`, `starting`, `running`, `running_single`, `running_dual`, `handing_off`, `stopping`, `error`
- `HandoffState`: `none`, `requested`, `preparing`, `ready_to_cutover`, `cutover_in_progress`, `completed`, `rolled_back`, `failed`
- `SpeculationState`: `disabled`, `listening`, `drafting_fast_path`, `speaking_speculative_prefix`, `awaiting_confirmation`, `committed`, `cancelled`, `replaced`
- `DuplexMode`: `single_turn`, `full_duplex_speculative`, `full_duplex_shadow_only`

---

## Correlation Rule
`correlationId` must remain unchanged across command handling and all emitted stream events.
