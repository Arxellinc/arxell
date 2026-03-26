# Simplification Opportunities

Areas where complexity can be reduced without losing capability. These are not "nice-to-haves" — reducing complexity directly improves stability and makes community contributions easier.

---

## 1. Unify the Two Chat Paths

**Current state:**
- `commands/chat.rs` — direct HTTP streaming to providers (used by the UI chat)
- `agent/src/` — the agent crate with its own `Agent::run_collect` loop (used by arx-rs CLI)

These are two separate implementations of essentially the same thing: send messages to a provider, handle streaming, handle tools, handle cancellation. They share no code.

**Impact of duplication:**
- Bug fixes in one path don't carry to the other
- Retry logic in `turn.rs` (2s/4s/8s backoff) is not available in the chat path
- The agent crate's compaction logic is not available in the UI chat
- Any new provider feature must be implemented twice

**Simplification:** Make `commands/chat.rs` use the agent crate. The agent crate already supports streaming events; the Tauri command just needs to forward those events to the frontend.

This is the single highest-value simplification and is a prerequisite for REPL loops anyway.

---

## 2. Shrink `lib.rs`

**Current state:** `lib.rs` is 1,283 lines covering:
- Struct definitions (`LocalServerHandle`, `AppState`, `ModelManagerState`)
- The entire startup sequence (`run()` function)
- The system usage emitter thread
- Memory sync logic

**Simplification:** Extract into modules:
- `startup.rs` — the `run()` function and startup sequence
- `state.rs` — `AppState`, `LocalServerHandle` struct definitions
- `system_monitor.rs` — the usage emitter thread

Each becomes ~200–300 lines. `lib.rs` becomes a thin re-export module.

**Why this matters for community:** A new contributor seeing a 1,283-line `lib.rs` as the entry point will struggle to understand where to start. Three 300-line files with clear names are far more approachable.

---

## 3. Flatten the A2A Command Split

**Current state:**
- `commands/a2a.rs` — handles A2A agent cards/process management
- `commands/a2a_workflow.rs` — handles workflow definitions and runs

The split between "a2a" and "a2a_workflow" is not obvious from the outside. They share the same database (`a2a.db`) but have separate command files.

**Simplification:** Merge into a single `commands/flows.rs` (rename to reflect the new flow-centric direction). This signals to contributors that the A2A system is the Flow system.

---

## 4. Eliminate the Python Dependency for TTS/STT (Medium term)

**Current state:**
- TTS: Kokoro ONNX Python daemon
- STT (Windows): Python whisper daemon

**Why Python is a problem:**
- Python version management (3.10 vs 3.11 vs 3.12) creates subtle incompatibilities
- The Kokoro runtime ZIP extraction + validation at startup is the primary cause of slow startup
- Python process management (zombie processes, restart logic) is error-prone
- On Windows, Python is frequently absent or in an incompatible state

**Simplification path:**
- TTS: `tract-onnx` (already a dep for Silero VAD) can run Kokoro ONNX models directly in Rust without Python. The Kokoro ONNX model is already bundled. Eliminate the Python TTS daemon
- STT: `whisper-rs` is already the default on Linux/macOS. For Windows, investigate `whisper.cpp` Win32 API build or use the `whisper-rs` with MSVC. The Python fallback should be last resort

This eliminates the main startup bottleneck and makes the voice pipeline 100% Rust.

**Effort:** Medium — requires porting the audio pre/post-processing from Python to Rust. The ONNX inference itself is trivial via `tract`.

---

## 5. Simplify the Audio Buffer

**Current state:**
```rust
pub audio_buffer: Mutex<Vec<f32>>,
```
A simple `Vec<f32>` behind a mutex used as the audio accumulation buffer.

**Problems:**
- No ring-buffer semantics — can grow unboundedly
- Acquisition blocks both capture and consumer
- Not suitable for real-time audio (mutex contention causes dropouts)

**Simplification:** Replace with `Arc<Mutex<VecDeque<f32>>>` with a max capacity, or use `ringbuf` (a lock-free ring buffer crate). `ringbuf` is the idiomatic approach for audio in Rust.

For a public release, the `VecDeque` with max capacity is sufficient and simple:
```rust
pub audio_buffer: Mutex<std::collections::VecDeque<f32>>,  // capped at, e.g., 16000 * 30 samples
```

---

## 6. Consolidate Settings Access

**Current state:** Settings are stored in `arx.db` (key-value table) and accessed via `commands/settings.rs`. Some settings are also read directly from the database in other command handlers without going through the settings module.

**Simplification:** Create a `Settings` struct that loads all settings at startup and caches them in `AppState`. Commands read from the cache; writes update both the cache and DB. This eliminates repeated DB queries for settings that rarely change.

---

## 7. Remove Unused Dependencies

A quick audit of `Cargo.toml` reveals several dependencies that may be unused or only conditionally needed:

- `redis` — present in Cargo.toml; if not used in any production code path, remove it
- `tokio-postgres` — similar concern; these are cloud integration stubs that aren't part of the desktop app's core
- `tauri-plugin-shell` — verify it's actually used; if it's just for the Python script invocation, it can be replaced with `std::process::Command`

Run `cargo machete` (a dead dependency detector) to get an authoritative list.

**Why this matters:** Every unused dependency increases compile time and attack surface. For a public open-source release, a clean `Cargo.toml` signals discipline.

---

## 8. Decouple the Frontend's ServePanel

**Current state:** `serveStore` is 21KB — the largest single store in the frontend. This suggests significant complexity has accumulated in the serve/deployment workflow.

**Problem:** Large stores tend to become coupling points where unrelated concerns share state. Changes in one part of the store break things in another.

**Simplification:** Without seeing the full store, the recommendation is to audit `serveStore` for sub-concerns that could be extracted into smaller stores. The principle: each store should own one coherent domain.

---

## 9. Standardize Error Handling in Commands

**Current state:** Tauri command return types vary across modules:
- Some return `Result<T, String>` (error is a plain string)
- Some return `Result<T, serde_json::Value>` (error is a JSON object)
- Some `unwrap()` internally and panic on error

**Simplification:** Define a canonical `ArxError` type:
```rust
#[derive(Debug, Serialize)]
pub struct ArxError {
    pub code: &'static str,    // machine-readable: "MODEL_NOT_LOADED", "DB_ERROR"
    pub message: String,       // human-readable
    pub details: Option<Value>,
}
```
All commands return `Result<T, ArxError>`. The frontend gets structured error information and can show appropriate messages.

This is a small change per command but has high impact on debuggability and user experience.

---

## 10. Collapse Tool Manifest Boilerplate

**Current state:** 23 tool manifests, each a TypeScript file with similar structure. Many are thin wrappers that just define an icon and name.

**Simplification:** For tools that don't have custom panels (pure metadata tools), support a JSON manifest format:
```json
{
  "id": "notes",
  "title": "Notes",
  "category": "aux",
  "defaultEnabled": false
}
```
This reduces the number of TypeScript files and makes it easier for community contributors to add new tools without touching React components.

---

## 11. Startup Progress Screen

This deserves its own entry because it's visible to every user on first launch.

**Current state:** Blank or frozen window during model deployment + Kokoro bootstrap (5–30 seconds).

**Simplification approach (not complexity addition):**
- Show the window immediately with a loading component (plain div, no dependencies)
- The loading component listens for `startup:progress` events from Rust
- Rust emits these events from async tasks running in the background
- The window transitions to the main UI when startup completes

This is 50–100 lines of Rust (event emissions) and 50 lines of TypeScript (loading UI). It makes the app feel dramatically more responsive and professional.

---

## Summary: Simplification Priority Order

| Item | Effort | User Impact | Community Impact |
|---|---|---|---|
| Startup progress screen | Low | Very High | Medium |
| Unify chat paths | Medium | High | Very High |
| Shrink lib.rs | Low | None | Very High |
| Standardize error types | Medium | High | High |
| Enable WAL mode (DB) | Very Low | Medium | Low |
| Remove unused deps | Low | Low | Medium |
| Python-free TTS | High | High | Medium |
| Audio ring buffer | Low | Medium | Low |
| Consolidate settings | Low | Low | Medium |
| Collapse tool manifests | Low | Low | High |
