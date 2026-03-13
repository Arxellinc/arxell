# Technical Architecture

## High-level architecture
arx is a Tauri v2 desktop app:
- Frontend: React + TypeScript + Zustand (Vite build)
- Backend: Rust commands invoked via Tauri IPC
- Data: SQLite in app data directory
- Event bus: Tauri events for streaming/log/progress/state updates

```mermaid
graph LR
  UI[React Frontend]\n(Chat/Sidebar/Workspace) -->|invoke| IPC[Tauri Commands]
  IPC --> DB[(SQLite)]
  IPC --> AI[AiClient / OpenAI-compatible APIs]
  IPC --> MM[Model Manager]\n(local metadata/load/inference/runtime)
  IPC --> Audio[Voice Pipeline]\n(cpal/VAD/STT/TTS)
  IPC --> FS[Workspace & Terminal IO]
  MM --> Engines[llama.cpp runtime binaries]
  Audio --> Py[Python scripts]\n(whisper/kokoro)
  IPC --> Events[Tauri Event Emitter]
  Events --> UI
```

## Agent execution flow
```mermaid
flowchart TD
  A[User prompt or Auto mode trigger] --> B[buildExtraContext(mode+skills+runtime+tasks+MCP)]
  B --> C[cmd_chat_stream]
  C --> D[AI stream -> chat:chunk]
  D --> E[Frontend tool-tag parser]
  E -->|write/read/task/browser tags| F[Execute mapped actions]
  F --> G[Optional follow-up prompt]
  D --> H[Finish message]
```

## Directory structure (major)
- `src/`: frontend app, stores, hooks, components, typed invoke wrappers.
- `src-tauri/src/`: Rust backend modules:
  - `commands/*`: Tauri command handlers,
  - `db/*`: SQLite schema/models,
  - `ai/*`: API client/stream parsing,
  - `audio/*`: capture/VAD/STT/TTS,
  - `model_manager/*`: metadata/load/inference/resources/system/runtime installer.
- `src-tauri/resources/`: ONNX and Python helper scripts.

## IPC model
- Command registration in `src-tauri/src/lib.rs` via `generate_handler![]`.
- Frontend uses `invoke` wrappers (primarily `src/lib/tauri.ts` and direct invoke in some stores/panels).
- Streaming/progress via events:
  - chat, voice, local inference, model load, engine install, log channels.

## State model
- Backend global state:
  - `AppState` (`Mutex<Connection>`, voice flags/buffers, cancel flags, local server handle).
  - `ModelManagerState` (`tokio::RwLock<ModelHolder>`).
- Frontend state:
  - multiple Zustand stores for chat, voice, workspace, serve, tasks, MCP, tool panel.

## Concurrency model
- Async commands for network/long operations.
- Blocking inference/tokenization wrapped with `tokio::task::spawn_blocking`.
- Voice capture uses dedicated threads.
- Shared backend state protected with `Mutex`/atomics/RwLock.

## External services/processes
- OpenAI-compatible APIs for chat/STT/TTS (optional).
- Local spawned processes:
  - `llama-server` runtime subprocess,
  - Python scripts for local STT/TTS,
  - optional system tools (`tar`, etc.).
