# Product Overview

## What arx is
arx is a desktop AI workstation built with Tauri (Rust backend + React frontend). It combines:
- conversational AI (streaming OpenAI-compatible chat),
- local model operations (GGUF metadata/load/runtime engine install),
- voice I/O (microphone capture, VAD, Whisper STT, Kokoro/Piper/external TTS),
- workspace editing tools (file tree, code editor, markdown/diff),
- task and MCP-oriented agent UX.

## Why it exists
The codebase shows a clear local-first and operator-control goal:
- persistent local SQLite state,
- direct endpoint/runtime control,
- on-device tooling in one interface,
- explicit status/diagnostics visibility.

## Target users
- End users wanting a local/private AI desktop workflow.
- Technical users running local or self-hosted OpenAI-compatible endpoints.
- Developers who need chat + coding + model/runtime controls in one app.
- Agent-oriented users managing tasks and MCP server definitions.

## Major capabilities
- Chat system:
  - Streaming response chunks via SSE (`chat:chunk` events).
  - Conversation/project organization.
  - Skill-injected system context and mode-specific prompts.
  - Optional auto mode dispatching pending tasks.
- Voice system:
  - Microphone capture via `cpal`.
  - ONNX Silero VAD with amplitude fallback.
  - Partial transcript events and prefill warmup.
  - STT engines: local faster-whisper Python, or external endpoint.
  - TTS engines: Kokoro Python, Piper binary, or external endpoint.
- Model and runtime system:
  - GGUF metadata probing without loading full weights.
  - Local model load/unload and generation config.
  - Engine status + installer for `llama.cpp` binaries from GitHub releases.
  - System resources, usage, storage, display, and identity introspection.
- API model account management:
  - Multiple API model configs with verification and primary selection.
  - Endpoint normalization toward OpenAI-compatible paths.
- Workspace/tooling:
  - File tree, editor, markdown preview, diff viewer.
  - Internal browser panel with proxy/reader/markdown modes.
  - Guardrailed terminal panel with path and command guard controls.
- Operational UX:
  - Diagnostics panel.
  - In-app log terminal tabs (frontend console + backend logs).

## Distinctive design choices (inferred from source)
- Local-first persistence and app_data_dir-centric storage.
- Broad Tauri IPC surface for a rich desktop control plane.
- Agent-context composition from runtime/system/task/MCP state.
- Single integrated UI spanning chat, model ops, system monitoring, and tools.
