# API and IPC Reference

## Tauri Commands

### Chat
| Command | Purpose | Inputs | Returns |
|---|---|---|---|
| `cmd_chat_stream` | Start streaming assistant response | `conversation_id`, `content`, `extra_context?`, `thinking_enabled?` | user `Message` |
| `cmd_chat_cancel` | Cancel active chat | none | `()` |
| `cmd_prefill_warmup` | Speculative prefill request | `conversation_id`, `partial_text?` | `()` |
| `cmd_chat_get_messages` | List messages | `conversation_id` | `Message[]` |
| `cmd_chat_clear` | Delete conversation messages | `conversation_id` | `()` |

### Projects/Conversations
| Command | Purpose |
|---|---|
| `cmd_project_create`, `cmd_project_list`, `cmd_project_delete`, `cmd_project_update` | Project CRUD |
| `cmd_conversation_create`, `cmd_conversation_list`, `cmd_conversation_list_all`, `cmd_conversation_get_last`, `cmd_conversation_delete`, `cmd_conversation_update_title`, `cmd_conversation_assign_project` | Conversation CRUD and assignment |

### Voice/Diagnostics
| Command | Purpose |
|---|---|
| `cmd_voice_start`, `cmd_voice_stop` | Voice capture control |
| `cmd_tts_speak` | Synthesize speech bytes |
| `cmd_check_voice_endpoints` | Legacy endpoint reachability checks |
| `cmd_list_audio_devices` | Enumerate audio input/output devices |
| `cmd_tts_check_engines`, `cmd_stt_check_engines` | Local/external engine availability |
| `cmd_tts_list_piper_models` | Scan Piper model directory |
| `cmd_voice_diagnostics` | Run voice diagnostic test suite |

### Settings/API Models
| Command | Purpose |
|---|---|
| `cmd_settings_get`, `cmd_settings_set`, `cmd_settings_get_all` | Key-value settings |
| `cmd_models_list` | Fetch model IDs from configured endpoint |
| `cmd_model_list_all`, `cmd_model_add`, `cmd_model_update`, `cmd_model_delete`, `cmd_model_set_primary`, `cmd_model_verify` | API model config management + verification |

### Skills
| Command | Purpose |
|---|---|
| `cmd_skills_list`, `cmd_skills_dir` | Skill metadata/directory |

### Workspace/Terminal/Browser
| Command | Purpose |
|---|---|
| `cmd_workspace_read_file`, `cmd_workspace_write_file`, `cmd_workspace_list_dir`, `cmd_workspace_create_file`, `cmd_workspace_delete_path` | File operations |
| `cmd_terminal_resolve_path`, `cmd_terminal_exec` | Guarded terminal path resolve + execution |
| `cmd_browser_info` | Browser panel info |
| `cmd_browser_fetch` | Fetch URL for agent use |

### Local Model + System
| Command | Purpose |
|---|---|
| `cmd_peek_model_metadata`, `cmd_load_model`, `cmd_unload_model` | Local model metadata/load lifecycle |
| `cmd_get_available_devices`, `cmd_is_model_loaded`, `cmd_get_loaded_model_info` | Device/model status |
| `cmd_count_tokens`, `cmd_render_prompt` | Token/prompt utilities |
| `cmd_get_generation_config`, `cmd_set_generation_config`, `cmd_get_serve_state` | Serve/generation state |
| `cmd_local_inference_stream` | Local streaming inference |
| `cmd_get_system_resources`, `cmd_get_system_usage`, `cmd_get_storage_devices`, `cmd_get_display_info`, `cmd_get_system_identity` | System introspection |
| `cmd_list_available_models`, `cmd_get_models_dir`, `cmd_open_models_folder` | Local model file management |
| `cmd_get_runtime_status`, `cmd_install_runtime_engine` | Runtime engine status/install |

## Events
| Event | Trigger | Payload |
|---|---|---|
| `chat:chunk` | SSE chunk/finish | `{id, delta, done}` |
| `chat:error` | Chat stream failure | `{message}` |
| `voice:state` | Voice pipeline state transitions | `{state}` |
| `voice:amplitude` | Live mic RMS | `{level}` |
| `voice:partial` | Partial transcription update | `{text}` |
| `voice:transcript` | Final transcript | `{text}` |
| `voice:error` | Voice error | `{message}` |
| `local:token` | Local inference token text | `string` |
| `local:done` | Local inference finished | `null` |
| `local:error` | Local inference error | `string` |
| `model:load_progress` | Model loading stage update | `{stage, percentage, message}` |
| `engine:install_progress` | Runtime installer progress | `{engineId, stage, percentage, message}` |
| `log:info`, `log:warn`, `log:error`, `log:debug` | Backend log forwarding | `string` |

## Error model
- Most commands return `Result<_, String>` (stringified backend errors).
- Some operations additionally emit async error events (`chat:error`, `voice:error`, `local:error`).
