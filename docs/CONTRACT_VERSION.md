# Contract Version

## Current Version
- `foundation-v4`

## Scope
This version pins the minimal vertical-slice contracts for:
- command: `cmd_chat_send_message`
- command: `cmd_chat_get_messages`
- command: `cmd_chat_list_conversations`
- response: `ChatSendResponse`
- response: `ChatGetMessagesResponse`
- response: `ChatListConversationsResponse`
- event channel: `app:event`
- command: `cmd_model_manager_list_installed`
- command: `cmd_model_manager_search_hf`
- command: `cmd_model_manager_download_hf`
- command: `cmd_model_manager_delete_installed`
- streaming actions:
  - `chat.stream.start`
  - `chat.stream.chunk`
  - `chat.stream.complete`
  - `chat.stream.error`
  - `model.manager.list_installed`
  - `model.manager.search_hf`
  - `model.manager.download_hf`
  - `model.manager.delete_installed`

## Compatibility Rule
- Any command, field, action, or payload shape change must:
  1. bump contract version (`foundation-v2`, etc.)
  2. update `IPC_EVENTS.md`
  3. document migration impact in PR/changeset

## Correlation Rule
`correlationId` must remain identical from request to all related events and final response.
