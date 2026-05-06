# Dependencies & Resource Analysis

Analysis of crates, npm packages, and bundled runtime resources consumed by the app. Last updated: 2026-05-06.

---

## Summary

This document separates three different cost categories that were previously conflated:

1. **Build footprint**: `target/`, `node_modules`, Cargo registry, and generated intermediates.
2. **Shipped app footprint**: what actually goes into desktop bundles (`dist/`, Rust binary, `src-tauri/resources/`).
3. **Dependency graph complexity**: direct and transitive crates/packages that affect compile time and maintenance.

Only the **shipped app footprint** matters for installer/app size. Large `target/` and `node_modules` directories are relevant to CI/local build costs, but they are not included in release artifacts.

| Metric | Value |
|--------|-------|
| **Rust direct deps (src-tauri)** | 33 |
| **Rust resolved deps (src-tauri)** | ~1,208 (with duplicates) / ~400 unique crates |
| **Rust direct deps (agent)** | 14 |
| **Rust resolved deps (agent)** | ~313 |
| **npm packages (frontend)** | 11 direct / ~322 total |
| **Bundled frontend assets (`frontend/dist`)** | ~164 MB before desktop packaging |
| **Bundled runtime resources (`src-tauri/resources`)** | ~281 MB |
| **Build-only `node_modules` footprint** | 423 MB |
| **Build-only compiled target footprint** | ~27 GB |

### What Actually Ships

The largest installed/bundled size contributors today are:

- `src-tauri/resources/` runtime assets (`~281 MB`)
- Mermaid/diagram chunks in `frontend/dist/assets/`
- the Rust desktop binary and platform bundle wrapper

The two biggest sources of avoidable shipped size are:

1. **Bundling platform-mismatched runtime files**
   - e.g. Linux ONNX runtime and Linux `whisper-server` assets being available to non-Linux builds unless explicitly excluded by platform-specific config.
2. **Bundling optional offline speech models by default**
   - The release bundle should ship `ggml-base-q8_0.bin`; smaller alternates such as `ggml-tiny.en-q8_0.bin` are optional downloads after installation.

---

## Heaviest Crates (by transitive dependency count)

| Crate | Transitive Crates | Driven By |
|-------|-------------------:|-----------|
| `tauri` | 355 | Core framework (WebView, IPC, plugins) |
| `arx_rs` (agent) | 170 | AI agent (LLM provider, streaming, tools) |
| `ironcalc` | 102 | Spreadsheet formula engine |
| `git2` | 66 | Vendored libgit2 (C lib) |
| `rusqlite` | 21 | SQLite (bundled C lib) |
| `portable-pty` | 27 | Pseudo-terminal |
| `ndarray` | 8 | N-dimensional arrays (TTS) |
| `chrono` | 13 | Date/time |
| `cpal` | 9 | Cross-platform audio I/O |
| `csv` | 6 | CSV read/write |
| `flate2` | 6 | Gzip decompression |
| `tar` | 8 | Tar archive extraction |
| `bzip2` | 8 | Bzip2 decompression |
| `keyring` | 2 | OS credential store |
| `ort-sys` | 2 | ONNX Runtime FFI |
| `sysinfo` | 3 | System metrics |

---

## Per-Tool/Panel Dependency Map

### Tools

| Tool | Backend Module(s) | Unique Heavy Crates | Shared Crates | Transitive Count (approx.) |
|------|-------------------|---------------------|---------------|--------------------------:|
| **terminal** | `app/terminal_service.rs` | `portable-pty` | tokio, serde | 27 |
| **files** | `app/files_service.rs` | (none — std::fs) | serde, serde_json | ~0 unique |
| **docs** | Same as files | (none) | serde, serde_json | ~0 unique |
| **sheets** | `services/sheets_service.rs`, `sheets_formula.rs`, `sheets_jsonl.rs`, `sheets_source.rs` | `ironcalc`, `csv`, `rusqlite` | serde, serde_json, thiserror | 102 |
| **chart** | `agent_tools/chart.rs` | (none unique) | arx_rs, serde_json, async-trait | ~0 unique |
| **notepad** | `agent_tools/notepad.rs` | (none unique) | arx_rs, tokio, dirs, serde_json | ~0 unique |
| **webSearch** | `app/web_search_service.rs` | (none unique) | reqwest, serde, tokio | ~0 unique |
| **tasks** | `app/tasks_service.rs` | `chrono`, `chrono-tz`, `rusqlite` | serde, serde_json | 21 |
| **memory** | `memory/mod.rs` | (none — std HashMap) | serde | ~0 unique |
| **looper** | `tools/looper_handler.rs`, `ipc/looper.rs` | (none unique — uses terminal) | portable-pty, reqwest, serde_json, tokio | ~0 unique |
| **opencode** | Reuses `app/terminal_service.rs` | (none unique) | portable-pty, serde_json | ~0 unique |
| **host** | `workspace_tools/mod.rs` | (none unique) | serde, serde_json | ~0 unique |
| **manager** | `workspace_tools/mod.rs` | (none unique) | serde, serde_json | ~0 unique |
| **flow** | Via looper handler | (none unique) | Same as looper | ~0 unique |

### Panels

| Panel | Backend Module(s) | Unique Heavy Crates | Shared Crates | Transitive Count (approx.) |
|-------|-------------------|---------------------|---------------|--------------------------:|
| **chatPanel** | `ipc/chat.rs` → `app/chat_service.rs` | (none unique) | arx_rs, reqwest, rusqlite, tokio, serde | ~0 unique |
| **apisPanel** | `api_registry.rs`, `secrets/mod.rs` | `keyring` | reqwest, uuid, tokio, serde | 2 |
| **settingsPanel** | `workspace_tools/mod.rs` | (none unique) | serde, serde_json | ~0 unique |
| **llamaCppPanel** | `app/runtime_service.rs` | `flate2`, `tar`, `zip`, `bzip2` | reqwest, tokio, serde | 8 |
| **modelManagerPanel** | `app/model_manager_service.rs` | (none unique) | reqwest, csv, serde | ~0 unique |
| **devicesPanel** | `app/permission_service.rs` | `cpal` | serde_json | 9 |
| **sttPanel** | `stt/mod.rs`, `stt/client.rs`, `stt/supervisor.rs` | (none unique) | reqwest (blocking), tokio, tauri | ~0 unique |
| **ttsPanel** | `tts/mod.rs`, `tts/kokoro_ort.rs`, `tts/phonemizer.rs` | `ort-sys`, `ndarray`, `libloading`, `base64` | tauri, serde | 8 |
| **avatarPanel** | Voice commands + chat | (none unique) | Same as voicePanel + chatPanel | ~0 unique |
| **voicePanel** | `ipc/voice_commands.rs` → `app/voice_runtime_service.rs` | (none unique) | ort-sys (VAD), serde, tokio | ~0 unique |
| **workspacePanel** | `workspace_tools/mod.rs`, `app/user_projects_service.rs` | (none unique) | dirs, serde, serde_json | ~0 unique |
| **historyPanel** | `ipc/chat.rs` → persistence | (none unique) | rusqlite, serde_json | ~0 unique |

---

## Bundled Runtime Resources

These are static files shipped with the app, located in `src-tauri/resources/`.

| Resource | Size | Used By |
|----------|-----:|---------|
| **kokoro/model_quantized.onnx** | 89 MB | TTS (Kokoro engine) |
| **whisper/ggml-base-q8_0.bin** | 78 MB | STT (whisper.cpp backend) |
| **onnxruntime/linux-x64/** | 16 MB | TTS (ONNX Runtime shared lib) |
| **espeak-ng/** | 26 MB | TTS (phonemizer data) |
| **kokoro/voices-v1.0.bin** | 27 MB | TTS (voice embeddings) |
| **kokoro/af.bin** | 512 KB | TTS (single voice file) |
| **whisper-server/** | 2 MB | STT (whisper.cpp server binary) |
| **sounds/** | 92 KB | Voice pipeline (notification sounds) |
| **llama-runtime/** | 12 KB | Llama.cpp runtime scripts |
| **kokoro-runtime/** | 8 KB | Kokoro runtime scripts |
| **Total** | **~281 MB** | |

### Notes on Current Resource Accuracy

- The `~281 MB` resource figure is the most important shipped-size number in this document.
- These resources are much more relevant to release size than `node_modules` or `target/`.
- Several current resources are platform-specific in practice:
  - `onnxruntime/linux-x64/libonnxruntime.so.1.20.1`
  - `whisper-server/whisper-server-linux-x86_64`
- Those should not be shipped to Windows/macOS bundles once platform-specific Tauri resource configs are in place.

---

## Crate-to-Tool Allocation

### Unique / Single-Tool Crates

These crates are used by only one feature. Removing the feature would eliminate these crates entirely.

| Crate | Feature | Notes |
|-------|---------|-------|
| `portable-pty` | terminal / looper / opencode | Pseudo-terminal; 27 transitive deps |
| `ironcalc` | sheets | Spreadsheet formula engine; 102 transitive deps. Feature-gated via `ironcalc-engine` |
| `ort-sys` | tts / VAD | ONNX Runtime FFI; used by `kokoro_ort.rs` and direct Silero VAD |
| `ndarray` | tts | N-dimensional arrays; used with ort-sys for TTS tensor ops |
| `libloading` | tts | Dynamic library loading for ONNX Runtime |
| `cpal` | devices (mic probe) | Audio device enumeration; 9 transitive deps |
| `git2` | (workspace/git features) | Vendored libgit2; 66 transitive deps |
| `flate2`, `tar`, `zip`, `bzip2` | llamaCppPanel | Archive extraction for runtime downloads |
| `sysinfo` | system metrics display | CPU/memory/network stats |
| `webkit2gtk` | Linux mic permissions | Linux-specific WebKit bindings |

### Shared Crates (used by 3+ features)

| Crate | Features Sharing It |
|-------|---------------------|
| `serde` + `serde_json` | All tools, all panels |
| `tokio` | All async modules |
| `tauri` | All IPC commands |
| `reqwest` | chatPanel, apisPanel, webSearch, llamaCppPanel, modelManagerPanel, sttPanel |
| `rusqlite` | chatPanel (persistence), sheets, tasks, historyPanel |
| `csv` | sheets, modelManagerPanel |
| `chrono` / `chrono-tz` | tasks, agent crate |
| `uuid` | apisPanel, api_registry |
| `keyring` | apisPanel (secrets), api_registry |
| `dirs` | notepad, workspacePanel, app_paths |
| `base64` | ttsPanel, agent crate |

---

## Agent Crate (`arx_rs`) Dependencies

The agent crate is a shared library at `agent/` providing the AI agent runtime (LLM provider, tool system, session management).

| Crate | Version | Purpose |
|-------|---------|---------|
| `reqwest` | 0.12 | HTTP + SSE streaming (rustls-tls) |
| `tokio` | 1 | Async runtime (macros, rt-multi-thread, process, fs) |
| `serde` + `serde_json` | 1 | Serialization |
| `thiserror` | 2 | Error derives |
| `async-stream` | 0.3 | Async stream generators |
| `async-trait` | 0.1 | Async trait bounds |
| `base64` | 0.22 | Encoding |
| `chrono` | 0.4 | Timestamp handling (serde, clock) |
| `futures-util` | 0.3 | Stream combinators |
| `globset` | 0.4 | File pattern matching |
| `ignore` | 0.4 | Gitignore-style directory walking |
| `regex` | 1 | Regular expressions |
| `toml` | 0.8 | TOML config parsing |
| `uuid` | 1 | Identifiers (v4, serde) |

---

## Frontend (npm) Dependencies

### Direct Dependencies (8 runtime + 3 dev)

| Package | Version | Used By |
|---------|---------|---------|
| `@tauri-apps/api` | 2.8+ | IPC bridge to Rust backend |
| `xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` | 5.3 | Terminal emulator |
| `mermaid` | 11.14 | Chart/diagram rendering |
| `highlight.js` | 11.11 | Code syntax highlighting |
| `three` | 0.183 | 3D rendering |
| `overlayscrollbars` | 2.15 | Custom scrollbars |

Dev: `typescript`, `vite`, `@types/three`

**node_modules size:** 423 MB (~322 total packages)

---

## Feature Flags

The `src-tauri/Cargo.toml` defines two feature flags:

| Feature | Effect | Default |
|---------|--------|---------|
| `tauri-runtime` | Enables `tauri` dep, Tauri command handlers, STT/TTS modules | Off |
| `ironcalc-engine` | Enables `ironcalc` in `sheets_formula.rs` for formula computation | Off |

When built without `tauri-runtime`, the app compiles as a library (`arxell_lite`) with all Tauri-specific code stripped via `#[cfg(feature = "tauri-runtime")]` gates.

---

## Build Impact Analysis

### Potential Savings if Features Were Made Optional

| Feature to Remove | Crates Eliminated | Est. Transitive Savings | Resource Savings |
|-------------------|-------------------|------------------------|-----------------|
| Voice pipeline (STT + TTS + VAD) | `ort-sys`, `ndarray`, `libloading`, `cpal`, `bzip2` | ~8 unique crates | ~281 MB resources |
| Git integration | `git2`, `libgit2-sys`, `libssh2-sys` | ~66 crates | — |
| Spreadsheet engine | `ironcalc` | ~102 crates | — |
| llama.cpp runtime | `flate2`, `tar`, `zip`, `bzip2` | ~8 crates | — |
| OS keychain secrets | `keyring` | ~2 crates | — |
| System metrics | `sysinfo` | ~3 crates | — |

### Safest Shipped-Size Reductions

These are the lowest-risk opportunities to reduce installer/app size without changing core behavior:

1. **Platform-specific resource bundling**
   - Only ship Linux runtime assets to Linux bundles, Windows assets to Windows bundles, etc.
   - High-confidence win with low product risk.

2. **Keep optional Whisper models out of the default bundle**
   - The default bundle includes `ggml-base-q8_0.bin` only.
   - Additional models such as `ggml-tiny.en-q8_0.bin` should remain download-on-demand.

3. **Reassess Mermaid as a shipped default**
   - Mermaid is code-split and lazy-loaded, but still lands in `dist/assets/`.
   - If the chart tool is non-core, removing Mermaid is a clean app-size reduction.

4. **Move voice runtimes to on-demand download**
   - Highest potential size win.
   - Not the safest immediate change because it affects offline/default behavior.

### Compile-Time Heavyweights

1. **`tauri` (355 transitive)** — unavoidable core framework
2. **`arx_rs` (170 transitive)** — core AI agent
3. **`ironcalc` (102 transitive)** — sheets only
4. **`git2` (66 transitive)** — vendored C lib with SSL/SSH
5. **`rusqlite` (21 transitive)** — bundled SQLite C lib

### Notes

- `git2` with `vendored-libgit2` feature builds libgit2 from C source, pulling in `libssh2-sys` and `openssl-sys` (significant compile time)
- `rusqlite` with `bundled` feature compiles SQLite from C amalgamation
- `sherpa-onnx` and `sherpa-onnx-sys` have been removed from the app dependency graph.
- `ironcalc` pulls in `statrs` (statistics), `kuchikiki` (HTML parser), and `icu_*` (Unicode) crates
- The agent crate (`arx_rs`) shares `reqwest`, `tokio`, `serde`, `serde_json`, `uuid`, `chrono`, `async-trait`, `thiserror`, `base64` with src-tauri
- The current frontend chart tool imports Mermaid lazily, but Mermaid still emits many `dist/assets/*Diagram*.js` chunks that ship with the app
- Build-size metrics (`node_modules`, `target/`) should be treated as CI/developer-cost signals, not release-size signals
