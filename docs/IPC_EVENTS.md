# IPC and Event Contracts (Foundation Slice)

## Command
- `cmd_chat_send_message`
  - input: `ChatSendRequest`
  - output: `ChatSendResponse`
- `cmd_chat_get_messages`
  - input: `ChatGetMessagesRequest`
  - output: `ChatGetMessagesResponse`
- `cmd_chat_list_conversations`
  - input: `ChatListConversationsRequest`
  - output: `ChatListConversationsResponse`
- `cmd_model_manager_list_installed`
  - input: `ModelManagerListInstalledRequest`
  - output: `ModelManagerListInstalledResponse`
- `cmd_model_manager_search_hf`
  - input: `ModelManagerSearchHfRequest`
  - output: `ModelManagerSearchHfResponse`
- `cmd_model_manager_download_hf`
  - input: `ModelManagerDownloadHfRequest`
  - output: `ModelManagerDownloadHfResponse`
- `cmd_model_manager_delete_installed`
  - input: `ModelManagerDeleteInstalledRequest`
  - output: `ModelManagerDeleteInstalledResponse`

## Event
- `app:event`
  - payload: `AppEvent`

## Chat Streaming Actions
- `chat.stream.start`
  - stage: `start`
  - payload: `{ conversationId }`
- `chat.stream.chunk`
  - stage: `progress`
  - payload: `{ conversationId, delta, done }`
- `chat.stream.complete`
  - stage: `complete`
  - payload: `{ conversationId, assistantLength }`
- `chat.stream.error`
  - stage: `error`
  - payload: `{ message }`

## Persistence Actions
- `conversation.append`
  - stage: `start|complete|error`
  - payload: append status/error details
- `conversation.list`
  - stage: `error`
  - payload: list read error details

## Correlation Rule
`correlationId` must remain unchanged across command handling and all emitted stream events.

## Model Manager Actions
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
