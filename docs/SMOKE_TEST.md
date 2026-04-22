# Smoke Test: Foundation Chat Streaming

## Goal
Validate minimal end-to-end behavior:
1. command path works
2. stream events are emitted
3. correlation id is preserved
4. frontend indicates runtime mode

## Automated (Rust side)
Run:
- `./scripts/smoke-chat-foundation.sh`

Checks performed:
- `cargo check`
- `cargo check --features tauri-runtime`
- `cargo run --quiet` contains:
  - `chat.stream.start`
  - `chat.stream.chunk`
  - `chat.stream.complete`
  - `corr=demo-001`
- conversation log contains both roles:
  - `"role":"user"`
  - `"role":"assistant"`

## Manual (UI side)
1. Start frontend:
- `cd frontend && npm install && npm run dev`

2. Start Tauri app (separate terminal):
- `cd src-tauri && cargo run --features tauri-runtime`

3. In UI:
- Verify badge shows `runtime: tauri`.
- Send message.
- Confirm assistant text appears incrementally.
- Confirm event panel shows streaming actions with same correlation id.

4. Browser-only fallback check:
- Run only frontend dev server in browser.
- Verify badge shows `runtime: mock`.
- Send message and confirm simulated streaming still works.

---

## Chat Cancel & Delete

1. Send a message and immediately cancel it.
2. Verify `cmd_chat_cancel_message` returns `cancelled: true`.
3. Verify no further streaming chunks arrive after cancel.
4. Open conversations list, delete a conversation.
5. Verify `cmd_chat_delete_conversation` returns `deleted: true` and conversation is removed from list.

## Terminal Session Lifecycle

1. Open a terminal session (`cmd_terminal_open_session`).
2. Verify a session id is returned.
3. Send input (`cmd_terminal_send_input`), verify output events arrive on `terminal.output`.
4. Resize terminal (`cmd_terminal_resize`), verify no error.
5. Close session (`cmd_terminal_close_session`), verify `closed: true`.

## Files Directory Listing

1. Invoke `cmd_files_list_directory` with no path.
2. Verify response includes `entries` array with `name`, `path`, `isDir`, `sizeBytes`.
3. Invoke with a subdirectory path, verify entries match that directory.

## API Connection CRUD

1. Create an API connection (`cmd_api_connection_create` with a test URL).
2. Verify response includes connection record with status.
3. List connections (`cmd_api_connections_list`), verify the new connection appears.
4. Probe an endpoint (`cmd_api_connection_probe`), verify response includes detected type.
5. Delete the connection (`cmd_api_connection_delete`), verify `deleted: true`.
6. Export connections (`cmd_api_connections_export`), verify JSON payload.
7. Import connections (`cmd_api_connections_import`), verify imported list.

## Workspace Tool Management

1. List workspace tools (`cmd_workspace_tools_list`).
2. Verify builtin tools (files, chart, looper, etc.) appear in the list.
3. Disable a tool (`cmd_workspace_tool_set_enabled` with `enabled: false`).
4. Re-list tools, verify the tool is disabled.
5. Re-enable it.
6. Export tools config (`cmd_workspace_tools_export`).
7. Import tools config (`cmd_workspace_tools_import`).

## Model Manager

1. List installed models (`cmd_model_manager_list_installed`).
2. Search HuggingFace (`cmd_model_manager_search_hf` with a test query).
3. List catalog CSV (`cmd_model_manager_list_catalog_csv`).
4. Verify response includes `rows` array with `repoId`, `fileName`, etc.

## LLaMA Runtime

1. Get runtime status (`cmd_llama_runtime_status`).
2. Verify response includes `engines` array and `state` field.
3. Start runtime if an engine and model are available.
4. Verify `endpoint` and `pid` are returned.
5. Stop runtime (`cmd_llama_runtime_stop`), verify `stopped: true`.

## TTS Engine Reset Behavior

1. Open the `TTS` panel.
2. Set non-empty paths/voice/speed on one engine (for example `Kokoro`).
3. Switch engine to `Piper`, then `Matcha`, then back to `Kokoro`.
4. Verify after each switch:
- stale model/secondary/tokens/data fields from prior engine are cleared
- voice/speed defaults are reset for the selected engine
- only engine-relevant secondary path row is visible:
  - `Kokoro`/`Kitten`: voices path
  - `Matcha`: vocoder path
  - `Piper`: no secondary-path row

## Voice / VAD

1. List VAD methods (`cmd_voice_list_vad_methods`).
2. Verify response includes `methods` array with manifests.
3. Get current settings (`cmd_voice_get_vad_settings`).
4. Set a VAD method (`cmd_voice_set_vad_method`).
5. Verify snapshot response reflects the change.
6. Start a voice session (`cmd_voice_start_session`), verify snapshot shows `running` state.
7. Stop the session (`cmd_voice_stop_session`), verify snapshot shows `idle`.

## Devices

1. Probe microphone (`cmd_devices_probe_microphone`).
2. Verify response includes `status` and `inputDeviceCount`.

## App Meta

1. Get app version (`cmd_app_version`), verify version string is non-empty.
2. Get resource usage (`cmd_app_resource_usage`), verify response includes `cpuPercent` and `memoryBytes`.
