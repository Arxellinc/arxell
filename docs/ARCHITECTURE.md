# Architecture Foundation

## Goal
Build a desktop AI chat application with strict layering so subsystems can be developed, tested, and migrated independently across Windows, macOS, and Linux.

## Layering Contract

1. Frontend (TypeScript)
- Pure rendering and user interaction.
- Must never contain business logic, tool policies, or persistence logic.

2. IPC Command Layer (Rust)
- Thin translation between frontend payloads and service-layer requests.
- Must never orchestrate use cases or directly call tools.

3. Application Service Layer (Rust)
- Owns orchestration/state machine behavior.
- Must never perform direct tool-side effects without registry indirection.

4. Tool Registry (Rust)
- Single policy and dispatch gateway for tools.
- Service layer calls tools only through this registry.

5. Tool Modules + Memory Manager (Rust)
- Side effects and platform-specific behavior are isolated here.
- No tool may call another tool directly.

## Dependency Direction

Allowed:
- frontend -> ipc
- ipc -> services
- services -> registry
- services -> memory manager
- registry -> tools

Forbidden:
- frontend -> services/tools/memory internals
- ipc -> tools directly
- services -> tools directly
- tool -> tool

## Subsystems

### Chat Service (`src-tauri/src/app/chat_service.rs`)
Core chat orchestration: message handling, agent loop, tool binding, streaming. Routes user messages to LLM providers and manages conversation lifecycle including cancel, delete, and listing.

### Terminal Service (`src-tauri/src/app/terminal_service.rs`)
PTY-based terminal sessions: open, input, resize, close. Emits `terminal.output` streaming events.

### Looper Handler (`src-tauri/src/tools/looper_handler.rs`)
PRD/build loop orchestration with multi-phase execution, interactive questions, and OpenCode integration. Routed through `cmd_tool_invoke`.

### Model Manager Service (`src-tauri/src/app/model_manager_service.rs`)
Local model lifecycle: list installed GGUF models, search HuggingFace, download, delete, and browse catalog CSV lists.

### LLaMA Runtime Service (`src-tauri/src/app/runtime_service.rs`)
Local inference runtime management: engine discovery, installation, start/stop with configurable parameters (context size, GPU layers, sampling).

### API Registry Service (`src-tauri/src/api_registry.rs`)
API connection CRUD: create, probe, verify, update, delete, import/export. Stores encrypted API keys and tracks connection status.

### Web Search Service (`src-tauri/src/app/web_search_service.rs`)
Web search execution. Routes queries to configured search API connections.

### Files Service (`src-tauri/src/app/files_service.rs`)
Filesystem operations: list directories, read/write files, create directories, delete paths. All operations go through permission checks.

### Permission Service (`src-tauri/src/app/permission_service.rs`)
Permission enforcement for tool actions, file access, and runtime operations.

### Voice Runtime Service (`src-tauri/src/app/voice_runtime_service.rs`)
Voice session management with VAD method selection, duplex modes, handoff between VAD methods, shadow evaluation, and speculation.

### STT Subsystem (`src-tauri/src/stt/`)
Speech-to-text: backend selection, model management, streaming transcription via Whisper-compatible servers.

### TTS Subsystem (`src-tauri/src/tts/`)
Text-to-speech: multi-engine support (Kokoro, Piper, Matcha, Kitten), voice selection, settings management, self-test, model download.

### Skills System (`src-tauri/src/skills/`)
Agent skill definitions: 8 specialized skills for orchestration, planning, product design, frontend/backend/database engineering, guardrails, and product vision.

### Persistence Layer (`src-tauri/src/persistence/`)
Data persistence for conversations, API connections, workspace tool settings, and voice configuration.

### Memory Subsystem (`src-tauri/src/memory/`)
Memory management for agent context and conversation history.

## Tool Contract Rules
- Every tool implements a single common trait.
- Trait is platform-agnostic.
- Platform details stay private inside each tool module.
- Tool I/O is typed and explicit.

## Event and Troubleshooting Rules
- Every command and service operation must emit structured events.
- Every event must include:
  - timestamp
  - correlation_id
  - subsystem
  - action
  - stage (start, progress, complete, error)
  - severity
  - payload
- Events must avoid leaking secrets (API keys, tokens, raw credentials).

## Completed Milestones
The following were originally listed as foundation-stage non-goals but are now implemented:
- Model inference integration (LLaMA runtime service)
- STT/TTS pipeline integration (full subsystems with multi-engine support)
- Persistence schema (conversations, connections, settings, voice config)
- Agent loop with planner (chat service agent loop, flow, looper, skills)
