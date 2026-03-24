# Tauri Integration Guide (Foundation)

This foundation now includes a feature-gated Tauri bridge in Rust.

## Feature
Enable with:
- `cargo run --features tauri-runtime`
- or for checks: `cargo check --features tauri-runtime`

## Rust Bridge Components
- `ipc/tauri_bridge.rs`
  - `TauriBridgeState` for managed command state
  - event forwarder: emits `app:event` with `AppEvent` payload
- `main.rs` (feature `tauri-runtime`)
  - command: `cmd_chat_send_message`
  - invoke handler registration

## Expected Frontend Wiring
Frontend already calls:
- command: `cmd_chat_send_message`
- command: `cmd_chat_get_messages`
- command: `cmd_chat_list_conversations`
- event channel: `app:event`

## App Setup Requirements in a Tauri Entry Point
1. Create `AppContext`.
2. Attach event forwarder:
   - `attach_event_forwarder(app.handle().clone(), app_context.ipc.event_hub())`
3. Manage state:
   - `TauriBridgeState { chat: Arc<ChatCommandHandler>, hub: EventHub }`
4. Register command handler:
   - `tauri::generate_handler![cmd_chat_send_message, cmd_chat_get_messages, cmd_chat_list_conversations]`

## Event Guarantees
- Correlation ID preserved across command + stream events.
- Streaming actions emitted:
  - `chat.stream.start`
  - `chat.stream.chunk`
  - `chat.stream.complete`
  - `chat.stream.error`
