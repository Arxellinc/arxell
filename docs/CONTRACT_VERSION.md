# Contract Version

## Current Version
- `foundation-v3`

## Scope
This version pins the minimal vertical-slice contracts for:
- command: `cmd_chat_send_message`
- command: `cmd_chat_get_messages`
- command: `cmd_chat_list_conversations`
- response: `ChatSendResponse`
- response: `ChatGetMessagesResponse`
- response: `ChatListConversationsResponse`
- event channel: `app:event`
- streaming actions:
  - `chat.stream.start`
  - `chat.stream.chunk`
  - `chat.stream.complete`
  - `chat.stream.error`

## Compatibility Rule
- Any command, field, action, or payload shape change must:
  1. bump contract version (`foundation-v2`, etc.)
  2. update `IPC_EVENTS.md`
  3. document migration impact in PR/changeset

## Correlation Rule
`correlationId` must remain identical from request to all related events and final response.
