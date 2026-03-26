# Architecture Deep Dive

---

## 1. Rust Backend (`src-tauri/src/`)

### 1.1 AppState — The Central Nervous System

`AppState` is the god object held as a Tauri managed state. It carries:

```rust
pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,      // main database
    pub a2a_db: Mutex<rusqlite::Connection>,  // workflow database
    pub voice_active: Mutex<bool>,
    pub audio_buffer: Mutex<Vec<f32>>,
    pub chat_cancel: Arc<AtomicBool>,
    pub speculative_cancel: Arc<AtomicBool>,
    pub generation_id: Arc<AtomicU64>,
    pub voice_running: Arc<AtomicBool>,
    pub local_server: Mutex<Option<LocalServerHandle>>,
    pub kokoro_daemon: KokoroDaemonHandle,
    pub whisper_daemon: WhisperDaemonHandle,
    pub whisper_rs_ctx: WhisperRsHandle,
    pub http_client: reqwest::Client,
    pub memory_dir: PathBuf,
}
```

**Issues identified:**
- Two separate SQLite connections (`db` and `a2a_db`) each wrapped in `Mutex<Connection>`. This is a single-connection approach with coarse locking — adequate for current scale but will bottleneck under concurrent agent workflows
- `audio_buffer: Mutex<Vec<f32>>` — entire audio buffer behind a single lock; will block if TTS and STT overlap
- No connection pool; long operations block all other DB writes
- `ModelManagerState` is a separate managed state — good separation, but communication between it and `AppState` is implicit

### 1.2 Module Structure

```
src-tauri/src/
├── lib.rs              (1,283 lines — startup, AppState, system usage emitter)
├── main.rs             (thin shim)
├── a2a/                (A2A agent card store, workflow store)
├── ai/                 (provider routing, streaming proxy)
├── audio/              (capture, STT, TTS, VAD, devices)
├── commands/           (20 Tauri command modules)
├── db/                 (SQLite schema, migrations)
├── memory/             (memory file sync)
└── model_manager/      (engine installer, GGUF loader, system info, tokenizer)
```

**Good:** Clear separation of concerns at the directory level.
**Problem:** `lib.rs` at 1,283 lines is doing too much — startup orchestration, system monitoring, state definitions, and the `run()` function all live here. The startup sequence has grown organically and has timing dependencies that are implicit.

### 1.3 The `run()` Startup Sequence

The app startup in `lib.rs::run()` does the following steps in order:

1. Init logging
2. Determine app data directory
3. Init `arx.db` + `a2a.db`
4. Deploy bundled Whisper models (file extraction)
5. Bootstrap Kokoro TTS Python runtime (ZIP extraction + import validation)
6. Check for and adopt or kill any stale `llama-server` PID
7. Spawn system usage emitter thread (~1 Hz)
8. Register all command handlers
9. Show main window

**Issues:**
- Steps 4–6 (model deployment + Python bootstrap) block the main thread during startup. The user sees a blank window for potentially 3–10 seconds on first run
- The Kokoro bootstrap does ZIP extraction synchronously; on slow hardware this takes 10–30 seconds
- There is no progress reporting to the frontend during startup — the app just appears frozen
- Steps are not retryable individually if one fails; a failure in step 5 does not cleanly skip to step 6

**Recommendation:** Move all heavy startup tasks (model deployment, Python bootstrap) to an async background task that emits progress events to the frontend. Show a startup progress screen. This does not require restructuring the whole app — just a `tauri::async_runtime::spawn` with event emission.

### 1.4 Database Layer (`db/`)

- Two SQLite databases: `arx.db` (conversations, messages, settings) and `a2a.db` (workflows, runs, credentials)
- Schema managed via manual SQL migrations in `db/`
- Each DB access acquires a `Mutex<Connection>` lock

**Issues:**
- No WAL mode enabled (or if it is, it's not prominent) — default journal mode will cause write contention
- No connection pool — all writes are serialized behind a single mutex
- Migration system is likely manual/ad-hoc; no numbered migration tracking visible
- Credentials stored in `a2a.db` — unclear if they're encrypted at rest or just base64

**Recommendation for stability:** Enable WAL mode (`PRAGMA journal_mode=WAL`) on both databases. This is a one-line change that dramatically improves concurrent read/write performance.

---

## 2. Agent Crate (`agent/src/`)

This is the most architecturally clean part of the codebase.

### 2.1 Agent Loop

```
Agent::run_collect(query, images, cancel)
  └── loop (turn < max_turns)
        └── run_single_turn(provider, messages, tools, system_prompt, turn, cancel)
              ├── provider.stream(messages, system_prompt, tools)
              ├── consume StreamPart events
              │     ├── Think → ThinkingStart/Delta/End
              │     ├── Text → TextStart/Delta/End
              │     ├── ToolCallStart/Delta → ToolStart/ArgsDelta
              │     └── Done → stop_reason
              └── execute tools concurrently
                    └── tool.execute(arguments, cancel)
```

**Strengths:**
- Clean separation: `Agent` (loop logic) vs `turn.rs` (single turn) vs `provider/` (network I/O)
- `cancel: Option<tokio::sync::watch::Receiver<bool>>` — cancellation is properly threaded through
- Exponential backoff retry (2s, 4s, 8s) on provider errors
- Compaction logic to handle context window overflow
- Event-based output: all progress is emitted as `Vec<Event>` rather than side effects

**Weaknesses:**
- `run_collect()` collects ALL events into a Vec before returning — suitable for the CLI binary but unsuitable for streaming real-time progress to a UI. The Tauri integration likely duplicates this as a separate streaming path
- Context compaction uses a separate LLM call (generate_summary) — if the provider is the local model, this blocks inference for the summary generation
- `count_tokens(text)` in `turn.rs` uses `text.len() / 4` — a rough approximation. This underestimates token counts for non-Latin scripts and JSON
- Tools are executed sequentially in a `for p in pending` loop despite being independent — they could run concurrently via `tokio::join_all`

### 2.2 Provider Abstraction

```rust
trait Provider {
    async fn stream(...) -> Result<StreamResponse, String>;
    fn should_retry_for_error(&self, error: &str) -> bool;
    fn config(&self) -> ProviderConfig;
}
```

Implementations: `openai_compatible`, `mock`

**Good:** Simple, extensible. Adding Anthropic native SDK or Ollama is just implementing this trait.
**Gap:** Only one provider can be active at a time per Agent instance. For multi-agent loops, each sub-agent would need its own provider. This works but requires careful instantiation.

### 2.3 Session Management

Sessions use a versioned schema with entries:
- `Message` (user/assistant/tool_result)
- `Compaction` (summary of earlier context)
- `ModelChange`

Entries have `id` and optional `relation` for branching.

**Good:** Supports conversation branching, compaction, and model switching within a session.
**Gap:** Session is in-memory in the agent crate and persisted separately by the Tauri DB layer. These two representations could drift if there are serialization differences.

---

## 3. Frontend Architecture (`src/`)

### 3.1 Layout

Three-panel layout in `App.tsx`:
```
[Sidebar] | [Chat Panel] | [Workspace Panel]
```
Each panel is resizable via drag handles. The workspace panel is driven by the active tool.

### 3.2 Tool System

Tools are React components registered via `ToolManifest`. Each tool declares:
- `id`, `title`, `description`, `icon`, `category`
- Optional `panel: ComponentType` — the workspace pane React component
- `defaultEnabled`, `capabilities`

The tool catalog is managed by `toolCatalogStore` (Zustand). Available tools are enabled/disabled per session.

**Strength:** Very clean plugin system — adding a new tool is just implementing a manifest and panel component.
**Gap:** There's no way for an agent to _activate_ a tool programmatically. The tool catalog is frontend-only state. A running agent loop cannot say "open the flow tool now" — the user must do it manually.

### 3.3 State Management

Zustand stores are used throughout. Notable ones:
- `chatStore`: Messages, current conversation, streaming state
- `serveStore` (21KB): Large store — likely overloaded with serve-mode concerns
- `flowWorkflowStore`: A2A workflows
- `voiceStore`: Voice device state

**Issue:** `serveStore` at 21KB is a sign of store bloat. Multiple concerns likely collapsed into one store.

### 3.4 Tauri IPC

All backend communication is via `invoke()` calls and event listeners. The pattern is consistent throughout. The bindings in `src/lib/tauri.ts` are the canonical interface.

**Good:** Clean separation — the frontend never touches the filesystem directly.
**Gap:** There's no typed event schema shared between Rust and TypeScript. Events emitted from Rust (`emit("a2a:workflow_changed", ...)`) are consumed as untyped JSON in the frontend. A code-gen step to produce TypeScript types from the Rust structs (e.g., using `specta` + `tauri-specta`) would eliminate an entire class of bugs.

---

## 4. Audio Pipeline

```
[Microphone] → CPAL capture → Silero VAD → Whisper STT → text → chat input
[Chat response] → Kokoro TTS Python daemon → audio samples → CPAL playback
```

The pipeline uses:
- `tract-onnx` for Silero VAD inference (pure Rust, no Python)
- `whisper-rs` (non-Windows) or Python whisper daemon for STT
- Python Kokoro daemon for TTS

**Issues:**
- Python dependency for both STT (fallback) and TTS introduces a significant surface area:
  - Python version conflicts
  - PyPI package installation failures
  - Process management (zombie processes, restart logic)
  - Windows path issues with Python executables
- The Kokoro daemon is bootstrapped from a ZIP file at startup — this is brittle and slow
- Audio device hot-plug (plugging in a headset mid-session) may not reconcile cleanly on all platforms
- No graceful degradation: if Python fails, voice is entirely disabled without clear user messaging

---

## 5. Model Manager

### 5.1 Engine Installer

Downloads and manages `llama-server` binaries for each platform/GPU combo. Handles:
- PID adoption (reuse a server started in a previous session)
- PID cleanup (kill stale servers from crashed sessions)
- Multi-backend: CUDA, Metal, Vulkan, ROCm, CPU

**Good:** Very thorough — handles the complex lifecycle of an external binary process.
**Issue:** `system_info.rs` at 77KB is enormous. GPU detection involves platform-specific probing (PowerShell on Windows, sysfs/nvidia-smi on Linux, IOKit on macOS). This code has high maintenance burden and frequent edge cases.

### 5.2 State File Persistence

A state file records the running llama-server PID and config between sessions. On startup, the app reads this file and either re-adopts or kills the process.

**Good:** Prevents GPU memory leaks from orphaned processes.
**Issue:** Race condition potential: if the app crashes hard and the state file is stale, the PID it records may have been reused by the OS for a different process. There is a `is_pid_alive()` check but it doesn't verify the process is actually llama-server.

---

## 6. A2A Workflow Engine

Located in `commands/a2a_workflow.rs` and `a2a/` directory.

### 6.1 Current Capabilities

- CRUD for `Workflow` (DAG definition) and `WorkflowRun` (execution instance)
- Concurrency limits: global 4, per-workflow 2
- Run tracing via `a2a:workflow_changed` and `a2a:run_trace_chunk` events
- Credential storage per workflow

### 6.2 What It Cannot Do Yet

- **Does not actually execute agent turns** — the A2A workflow engine stores and tracks workflow state, but the execution happens outside the Rust layer (JavaScript/frontend or manual trigger)
- **No dependency graph resolution** — nodes execute without topological ordering or dependency waiting
- **No retry semantics** at the workflow level — if a node fails, there's no configured retry policy
- **No streaming progress** from within a workflow node back to the UI during execution
- **No durable state** — if the app closes during a workflow run, the run is orphaned (no resume)
- **No inter-node data flow** — nodes cannot pass structured output to the next node as typed inputs

---

## 7. Memory System (`memory/`)

The memory system syncs `.md` files from a configured memory directory into the app. Files are read and injected into agent system prompts.

**Good:** Simple, file-based, human-readable.
**Gap:** No concept of memory expiry, relevance ranking, or embedding-based retrieval. For longer-duration agentic processes, relevant memory retrieval matters more than dumping all memory into a prompt.
