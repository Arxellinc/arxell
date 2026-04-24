# Release Readiness Review — Arxell Lite v0.1.9

**Reviewer:** GLM-5.1 (Automated Review)  
**Date:** 2026-04-24  
**Version reviewed:** 0.1.9 (Cargo.toml, package.json, tauri.conf.json)  
**Target:** Public desktop release (Linux, macOS, Windows)

---

## Executive Summary

**Verdict: Not ready for public release in its current state.** The application demonstrates strong architectural foundations — clean layering, good separation of concerns, typed contracts, and structured observability — but has several blocking issues: TypeScript compilation errors preventing a clean build path, failing unit tests, a Rust test compilation failure, and significant security concerns around API key storage and frontend secret exposure. The Tauri permission model is reasonable but has one critical overreach (Linux WebKit auto-granting all permissions). Code formatting violations and dead code indicate pre-release cleanup is needed.

### Top 5 Risks
1. **API keys stored in plaintext JSON** on disk with no encryption (`api-connections.json`)
2. **Frontend can retrieve raw API keys** via `cmd_api_connection_get_secret` — full secrets travel across IPC
3. **Linux WebKit auto-grants all permission requests** including microphone without user consent
4. **TypeScript type errors** in production code (sheets, chat, event handler types) — `npm run check` fails
5. **Failing tests** — both Rust (`cargo test` compile error) and frontend (`npm test` has TS errors)

---

## What Is Well Engineered

1. **Layered architecture.** The codebase follows the documented layering contract (Frontend → IPC → Services → Registry → Tools) rigorously. The IPC bridge in `src-tauri/src/ipc/tauri_bridge.rs` is thin, the service layer owns all orchestration, and tools never call other tools directly.

2. **Typed contract system.** Every IPC command has a dedicated request/response type pair in `contracts.rs` (~2000 lines). `serde(rename_all = "camelCase")` is consistently applied. The frontend mirrors these types in `contracts.ts`.

3. **Structured observability.** The `EventHub` pattern (`observability.rs`) with broadcast channels, ring-buffer history, structured events with correlation IDs, and payload redaction for secrets is genuinely well designed. Every service operation emits start/complete/error events.

4. **Workspace sandboxing for file operations.** `files_service.rs` correctly canonicalizes paths and verifies they remain within the workspace root. Both `resolve_existing_target_path` and `resolve_writable_target_path` check `starts_with(canonical_root)` after canonicalization — this is the correct approach to prevent path traversal.

5. **Graceful runtime lifecycle.** `LlamaRuntimeService` implements `Drop` for last-resort cleanup, uses process reconciliation (`reconcile_process_state`), and has health-check polling with timeouts. The terminal service properly manages PTY sessions with cleanup on close.

6. **Tauri capabilities are minimal.** `default.json` only exposes window management, dialog open, and core events. No shell, filesystem, or network Tauri plugins are directly exposed. The `stt-capability.json` is nearly identical — no overreach there.

7. **Feature-gated compilation.** The `tauri-runtime` feature flag cleanly separates Tauri-dependent code, and there's a standalone `main()` path for non-Tauri testing. This is good for CI and development.

8. **API key masking.** The registry correctly masks API keys in list/probe responses (`api_key_masked: "sk-xxxx***"`), validates against masked keys being re-submitted, and auto-flags connections with masked keys as `Warning`.

---

## Release Blockers

### B1. API Keys Stored Unencrypted on Disk
- **Severity:** Blocker (Security)
- **Evidence:** `src-tauri/src/api_registry.rs:448-472` — `persist_snapshot()` writes `ApiConnectionSecretRecord` (containing `api_key: String` in plaintext) to a JSON file via `serde_json::to_string_pretty`.
- **Why it matters:** Any user of the machine or malware can read `~/.local/share/com.arxell.lite/api-connections.json` and extract all API keys in plaintext. This is a credential leak vector.
- **Recommended fix:** Encrypt the `api_key` field at rest using the OS keychain (keyring crate) or a local encryption key derived from a machine-specific secret. At minimum, use AES-256-GCM with the key stored in the system credential store.
- **Validation:** Verify that the JSON file on disk never contains plaintext API keys.

### B2. Frontend Can Retrieve Full API Keys via IPC
- **Severity:** Blocker (Security)
- **Evidence:** `src-tauri/src/main.rs:1112-1124` — `cmd_api_connection_get_secret` returns the full `api_key` string to the frontend. `src-tauri/src/api_registry.rs:283-289` — `get_secret_api_key()` clones and returns the raw key.
- **Why it matters:** Tauri's IPC is not encrypted. Any compromised renderer or XSS can call this command to steal API keys. The frontend should never need raw API keys — the backend should handle all authenticated requests.
- **Recommended fix:** Remove `cmd_api_connection_get_secret` from the IPC handler. If the frontend needs to display key info, return only the masked version. All authenticated HTTP requests should originate from the Rust backend.
- **Validation:** Verify no Tauri command returns full API key strings to the frontend.

### B3. Linux WebKit Auto-Grants All Permissions
- **Severity:** Blocker (Security)
- **Evidence:** `src-tauri/src/main.rs:177-194` — The `connect_permission_request` handler calls `request.allow()` for all permission requests with a comment "Grant all permission requests (this is a development-only setting)".
- **Why it matters:** This grants microphone, camera, geolocation, and any other WebKit permission without user consent on Linux. The comment says "development-only" but it ships in production builds.
- **Recommended fix:** Gate this behind `#[cfg(debug_assertions)]` or implement a proper permission dialog. At minimum, only auto-grant media/microphone permissions.
- **Validation:** On a release build, verify that permission prompts appear for microphone access on Linux.

### B4. TypeScript Compilation Errors in Production Code
- **Severity:** Blocker (Build/Reliability)
- **Evidence:** `npm run check` (tsc --noEmit) produces 8 errors:
  - `src/main.ts(7975,27)`: `deleteMemory` does not exist on `ChatIpcClient`
  - `src/main.ts(8299,5)`: Unknown property `onRefreshed`
  - `src/main.ts(8389,9)`: Type mismatch — `(event: AppEvent) => boolean` not assignable to `(event: AppEvent) => Promise<void>`
  - `src/main.ts(8508,7)`: Unknown property `refreshFlowRuns`
  - `src/tools/sheets/state.ts(423)`: Arithmetic operation type errors
- **Why it matters:** Vite's build succeeds despite these errors (Vite strips types), but this indicates the codebase has drifted from its type definitions. Runtime behavior may be incorrect.
- **Recommended fix:** Fix all TypeScript errors. The missing `deleteMemory` method and type mismatches suggest the IPC client and its callers are out of sync.
- **Validation:** `npm run check` passes with zero errors.

### B5. Failing Tests
- **Severity:** Blocker (Quality)
- **Evidence:**
  - `cargo test` fails to compile: `src/services/sheets_service.rs:2144` — struct literal missing fields in a test.
  - `npm test` fails: `tests/sendMessageBootstrap.test.ts(56,7)` — missing properties `memoryAlwaysLoadToolKeys`, `memoryAlwaysLoadSkillKeys`; `tests/sheetsTool.test.ts` — missing module and missing `undoSheet`/`redoSheet` deps.
- **Why it matters:** Tests are out of sync with implementation. There is no CI safety net.
- **Recommended fix:** Update test fixtures to match current type definitions. Add missing methods and modules.
- **Validation:** `cargo test` and `npm test` both pass.

### B6. `cargo fmt --check` Fails
- **Severity:** Blocker (Code Quality)
- **Evidence:** Significant formatting violations across `main.rs`, `chat_service.rs`, `looper_handler.rs`, `sheets_service.rs`, and others. The diff shows hundreds of lines that need reformatting.
- **Why it matters:** For a public release, code formatting should be clean. Many CI pipelines enforce `cargo fmt --check`.
- **Recommended fix:** Run `cargo fmt`.
- **Validation:** `cargo fmt --check` exits with 0.

---

## High Priority Issues

### H1. Plaintext Export of API Keys
- **Evidence:** `src-tauri/src/api_registry.rs:291-321` — `export_portable_snapshot_json()` serializes all connections including `api_key` into a JSON string returned to the frontend.
- **Why it matters:** Even if the frontend handles this carefully, the export payload contains raw credentials that could be logged, cached, or intercepted.
- **Recommendation:** Offer a "redacted export" option by default, and require explicit user confirmation for full-key export.

### H2. No `unsafe` Justification Documentation
- **Evidence:** `src-tauri/src/stt/supervisor.rs:295-306` — Two `unsafe` blocks using `libc::kill()` with `SIGTERM` and `SIGKILL` for process termination on Unix.
- **Why it matters:** Sending signals to PIDs has TOCTOU risks (PID recycling). The code is correct for its purpose but undocumented.
- **Recommendation:** Add a safety comment block explaining why this is sound and what invariants are maintained.

### H3. Blocking `std::thread::sleep` in Permission Probe
- **Evidence:** `src-tauri/src/app/permission_service.rs:134` — `std::thread::sleep(Duration::from_millis(120))` inside `probe_microphone_inner()`.
- **Why it matters:** While this is run in `spawn_blocking`, it blocks a thread for 120ms per probe. The `cmd_devices_probe_microphone` command correctly uses `spawn_blocking`, so this is acceptable but should be noted.
- **Recommendation:** Consider reducing or removing the sleep, using the stream's own timing.

### H4. `.expect()` on AppContext Initialization
- **Evidence:** `src-tauri/src/app/mod.rs:43-44` — `.expect("failed to initialize conversation repository")` will panic if SQLite initialization fails (e.g., disk full, permissions).
- **Why it matters:** A panic during `AppContext::new()` will crash the app on startup with no user-friendly error.
- **Recommendation:** Return `Result<AppContext, String>` from `new()` and handle gracefully in `main()`.

### H5. Cancel-Check Polling Loop
- **Evidence:** `src-tauri/src/app/chat_service.rs:541-553` — A `tokio::spawn` loop that polls `cancelled_correlations` every 120ms.
- **Why it matters:** This creates a busy-loop task per chat request. With `watch::channel` already in use, a `watch::receiver` change listener would be more efficient.
- **Recommendation:** Use the watch channel receiver's `changed()` method instead of polling with sleep.

### H6. Test Artifact in Source Tree
- **Evidence:** `src-tauri/testA` — A 9-line JSONL file that appears to be test data for the sheets feature, committed to the source root.
- **Why it matters:** Unprofessional for a public release; looks like an accidental commit.
- **Recommendation:** Move to `src-tauri/tests/fixtures/` or remove.

### H7. `bundle.active: false` in tauri.conf.json
- **Evidence:** `src-tauri/tauri.conf.json:29` — `"active": false`.
- **Why it matters:** The bundler won't generate installers by default. The CI workflow may override this, but local builds won't produce distributable artifacts.
- **Recommendation:** Document that `--bundle` flag or CI is needed for production builds, or set `active: true` for release builds.

### H8. `devtools` Feature Enabled in Release
- **Evidence:** `src-tauri/Cargo.toml:12` — `tauri = { version = "2", optional = true, features = ["devtools"] }`.
- **Why it matters:** The `devtools` feature enables the WebView inspector in production builds, allowing users (or attackers) to inspect the frontend, modify state, and call Tauri commands directly.
- **Recommendation:** Gate `devtools` behind a `debug` feature flag that's only active in dev builds.

---

## Medium Priority Improvements

### M1. Clippy Warnings (25 total)
- **Evidence:** `cargo clippy` produces 25 warnings including `too_many_arguments`, `derivable_impls`, `manual_flatten`, and `unused_async`.
- **Recommendation:** Run `cargo clippy --fix` to auto-fix 14, manually address the rest.

### M2. Dead Code
- **Evidence:** `on_terminal_output`, `detect_preview_url`, `extract_session_id` in `looper_handler.rs`; `detect_format` in `sheets_service.rs`.
- **Recommendation:** Remove or prefix with `#[allow(dead_code)]` if reserved for future use.

### M3. Large Frontend Bundle
- **Evidence:** `index-ClYcqYX3.js` is 1.09 MB (285 KB gzipped). Mermaid diagrams add ~1.5 MB of JS across multiple chunks. Total frontend dist is 4.2 MB.
- **Recommendation:** Use dynamic `import()` for mermaid (only load when rendering diagrams). Consider tree-shaking unused mermaid diagram types.

### M4. `reqwest` with Both Blocking and Async Features
- **Evidence:** `Cargo.toml:22` — `reqwest` has both `"blocking"` and async features enabled.
- **Why it matters:** The blocking feature brings in a separate runtime thread pool. The codebase uses `reqwest::blocking` in `runtime_service.rs` (inside `spawn_blocking` tasks) and async reqwest elsewhere.
- **Recommendation:** Migrate `runtime_service.rs` to use async reqwest consistently, then remove the `"blocking"` feature to reduce binary size and avoid potential deadlocks.

### M5. No CSP `style-src` Directive
- **Evidence:** `tauri.conf.json:25` — CSP is `default-src 'self'; media-src 'self' mediastream:; connect-src ipc: http://127.0.0.1`.
- **Why it matters:** Without explicit `style-src`, it falls back to `default-src 'self'` which is fine, but the CSP lacks `img-src` (for chart rendering) and `font-src`. The `connect-src ipc: http://127.0.0.1` is broad — any local service can be reached.
- **Recommendation:** Tighten `connect-src` to specific ports used by the llama runtime. Add `style-src 'unsafe-inline'` if inline styles are needed for UI.

### M6. No Structured Logging
- **Evidence:** The codebase uses `log` crate and `eprintln!()` for logging, but no logger is initialized in `main()`. Observability relies on the event hub, not standard logging.
- **Recommendation:** Initialize `env_logger` or `tracing` in `main()` so that `log::info!` / `log::warn!` calls produce visible output. Replace `eprintln!` with proper log macros.

### M7. Looper Handler's 2300+ Line File
- **Evidence:** `src-tauri/src/tools/looper_handler.rs` is one of the largest files and has 3 dead functions.
- **Recommendation:** Split into sub-modules (e.g., `planner.rs`, `executor.rs`, `preview.rs`).

### M8. `webkit2gtk` Dependency Without Platform Guard in Code
- **Evidence:** `Cargo.toml:43` — `webkit2gtk = "2.0"` is a Linux-only dependency, correctly gated under `[target.'cfg(target_os = "linux")'.dependencies]`.
- **Why it matters:** This is correctly configured; just noting it's a heavy dependency that adds build complexity for Linux.

---

## Low Priority Polish

### L1. `serde_json::to_value(...).unwrap_or_else(|_| json!({}))` Pattern
- Used extensively in `chat_service.rs` for event payloads. This silently drops serialization errors. Not a risk but could hide data shape bugs.

### L2. Version Synchronization
- Versions in `Cargo.toml`, `package.json`, and `tauri.conf.json` must be manually kept in sync. The `version:check` npm script exists but is not enforced.

### L3. Window State Persistence Without Error Visibility
- `main.rs:174` calls `restore_window_state` and `persist_window_state` but their implementations are not in the reviewed code. If these fail silently, users may lose window position/size.

### L4. No `.github/ISSUE_TEMPLATE` or `CONTRIBUTING.md`
- For a public release, issue templates and contribution guidelines help community engagement.

### L5. `agent/` Directory Contains External Crate
- `arx_rs = { path = "../agent" }` is a local path dependency. This must be published or vendored for external users to build the project.

---

## Security Review

### Permission Model (Tauri)
| Area | Assessment |
|------|-----------|
| Tauri capabilities | **Good.** Minimal set: window management, dialog open, core events. No shell/filesystem plugins exposed. |
| Custom commands | **Broad.** 80+ Tauri commands are registered. All return `Result<T, String>` which is good for error propagation but means any command can be called from the frontend. |
| Shell access | **Medium risk.** Terminal service gives full shell access via PTY. This is by design but should be documented. |
| File system access | **Good.** Path traversal prevented by canonicalization + prefix checks. However, the workspace root defaults to CWD which may be too broad. |
| Network access | **Medium risk.** `connect-src http://127.0.0.1` allows connections to any local port. `reqwest` is used for both local and remote (HuggingFace, search APIs) calls. |

### Secrets Handling
| Area | Assessment |
|------|-----------|
| API key storage | **Poor.** Plaintext in JSON file. No encryption. |
| API key in transit (IPC) | **Poor.** `cmd_api_connection_get_secret` sends full keys to frontend. Export includes full keys. |
| API key in events | **Good.** `redact_payload()` in `observability.rs` strips `api_key`, `token`, `secret`, `password`, `authorization` from event payloads. |
| API key in memory | **Acceptable.** Keys are in `RwLock<HashMap>` behind `ApiRegistryService`. Not zeroed on drop but this is standard for Rust. |

### Injection Risks
| Area | Assessment |
|------|-----------|
| SQL injection | **None.** SQLite uses parameterized queries (`rusqlite` `params![]`). |
| Command injection | **Low risk.** Terminal input is passed directly to PTY (by design). `runtime_service.rs` constructs `Command` from typed parameters, not shell strings. |
| Path traversal | **Protected.** `files_service.rs` canonicalizes and validates paths. |

### Dependency Risk
| Dependency | Risk | Notes |
|-----------|------|-------|
| `sherpa-onnx` | **Medium** | Large ML inference library with native code. Limited ecosystem adoption. |
| `portable-pty` | **Low** | Well-established PTY library. |
| `rusqlite` (bundled) | **Low** | Bundled SQLite is standard practice. |
| `git2` (vendored) | **Medium** | Heavy dependency (~5MB compiled). Vendored libgit2 adds build time. |
| `reqwest` (rustls) | **Good** | Uses rustls instead of OpenSSL — smaller attack surface. |
| `mermaid` (frontend) | **Medium** | Large dependency (1.5MB JS). Rendering untrusted mermaid diagrams could be a DoS vector. |
| `arx_rs` (path dep) | **High** | Local path dependency — cannot be built by external users without this crate. |

---

## Reliability Review

### Crashes and Panics
- `src-tauri/src/main.rs:313` — `.expect("failed to run tauri app")` will panic if Tauri fails to initialize. This is standard for Tauri apps.
- `src-tauri/src/app/mod.rs:44` — `.expect("failed to initialize conversation repository")` will crash on startup if SQLite init fails.
- Multiple `.expect("lock poisoned")` calls throughout — these panic if a thread holding a lock panics. This is a deliberate design choice (fail-fast) but could be more graceful.

### Error Handling
- All Tauri commands return `Result<T, String>`. Error messages are descriptive and user-facing.
- The `ChatService::send_message` method has a well-designed fallback chain: Agent → Legacy → Error, with detailed event emissions at each stage.

### Concurrency
- `ApiRegistryService` uses `RwLock` correctly (read for list/get, write for create/update/delete).
- `TerminalService` uses `Mutex` for session map and per-session writers.
- `LlamaRuntimeService` uses `Mutex<RuntimeState>` with `try_lock()` fallback (graceful degradation if poisoned).
- The cancel mechanism in chat uses `Arc<Mutex<HashSet<String>>>` polled every 120ms — functional but inefficient.

### Platform Risks
- **Linux:** Requires `webkit2gtk` for WebKit permissions. The auto-grant permission handler is a blocker.
- **macOS:** Needs microphone entitlements in the app bundle (not reviewed but likely needed for STT).
- **Windows:** `CREATE_NO_WINDOW` flag correctly used for subprocess spawning. `portable-pty` has Windows support.

---

## Performance Review

### Startup
- `AppContext::new()` initializes SQLite, API registry (reads JSON file), workspace tools, and starts event listener — all synchronous on the main thread. This could block UI startup.
- Frontend loads 4.2 MB of JS assets. The `index` chunk alone is 1.09 MB.

### Runtime
- **Good:** Heavy operations (model search, downloads, file operations) correctly use `tokio::task::spawn_blocking`.
- **Good:** Terminal output uses dedicated std threads for reading PTY output.
- **Concern:** `reqwest::blocking::Client` in `runtime_service.rs` runs inside `spawn_blocking` — this is correct but means a blocking HTTP client is used for downloading large engine binaries (~100MB+). An async client with progress reporting would be better.
- **Concern:** The `select_agent_tools_for_request` method in chat_service.rs scans tool names using keyword matching against user message text — this is O(n*m) but with small n, acceptable.

### Frontend Bundle
| Asset | Size | Gzipped |
|-------|------|---------|
| index.js | 1,093 KB | 286 KB |
| mermaid.core.js | 599 KB | 145 KB |
| wardley.js | 492 KB | 110 KB |
| cytoscape.esm.js | 442 KB | 141 KB |
| katex.js | 259 KB | 77 KB |
| **Total dist** | **4.2 MB** | — |

The mermaid and diagram libraries account for ~60% of the bundle. Lazy-loading these would dramatically improve initial load time.

---

## Frontend/UX Review

### Architecture
- Single-file `main.ts` appears to be extremely large (8000+ lines based on error line numbers). This should be split into modules.
- The IPC client (`ipcClient.ts`, 2338 lines) is comprehensive and type-safe.
- Tools are organized in `src/tools/` with per-tool directories.

### State Management
- React 18 with what appears to be custom state management (no Redux/Zustand detected).
- State appears to be managed through the IPC client and local component state.

### Error Handling (Frontend)
- TypeScript errors indicate some code paths are not type-safe at compile time.
- The `deleteMemory` missing method suggests a feature was partially implemented.

### Accessibility
- Not deeply reviewed, but the custom `decorations: false` window means the app manages its own title bar, which needs proper accessibility labels.

---

## Test and Build Results

| Command | Result | Notes |
|---------|--------|-------|
| `cargo check` | **PASS** (5 warnings) | Dead code warnings only |
| `cargo clippy` | **PASS** (25 warnings) | too_many_arguments, derivable_impls, manual_flatten |
| `cargo fmt --check` | **FAIL** | Significant formatting violations |
| `cargo test` | **FAIL** | Compilation error in sheets_service test (missing struct fields) |
| `npm run build` | **PASS** | Built in 6.77s, large chunk warning |
| `npm run check` | **FAIL** | 8 TypeScript errors in main.ts and sheets/state.ts |
| `npm test` | **FAIL** | TS errors in test files, missing properties and modules |

---

## Recommended Release Plan

### 1. Must Fix Before Public Release
- [ ] **B1:** Encrypt API keys at rest or use OS keychain
- [ ] **B2:** Remove `cmd_api_connection_get_secret` or restrict it significantly
- [ ] **B3:** Gate Linux WebKit auto-grant behind `#[cfg(debug_assertions)]`
- [ ] **B4:** Fix all TypeScript compilation errors
- [ ] **B5:** Fix failing Rust and frontend tests
- [ ] **B6:** Run `cargo fmt`
- [ ] **H8:** Remove `devtools` feature from release builds
- [ ] **H6:** Remove or relocate `testA` artifact

### 2. Should Fix Before Public Release
- [ ] **H1:** Add confirmation/redaction option for API key exports
- [ ] **H4:** Make `AppContext::new()` fallible
- [ ] **H5:** Replace cancel polling loop with watch receiver
- [ ] **M1:** Fix clippy warnings
- [ ] **M2:** Remove dead code
- [ ] **M3:** Lazy-load mermaid diagrams
- [ ] **M5:** Tighten CSP connect-src
- [ ] **M6:** Initialize a structured logger

### 3. Can Fix After Release
- [ ] **M4:** Remove `reqwest` blocking feature
- [ ] **M7:** Split looper_handler.rs into sub-modules
- [ ] **L1-L5:** Polish items (unwrap patterns, version sync, docs)
- [ ] Refactor main.ts into modules
- [ ] Add more comprehensive tests

---

## Confidence and Limitations

### What Was Reviewed
- All Rust source files in `src-tauri/src/` (architecture, commands, services, persistence, tools, STT, TTS, voice)
- Tauri configuration (`tauri.conf.json`, capabilities)
- Cargo dependencies and build configuration
- Frontend package.json, build output, IPC client
- CI/CD workflow (`build-desktop.yml`)
- All static check outputs (cargo check, clippy, fmt, tsc, npm build, tests)

### What Could Not Be Reviewed
- **`arx_rs` agent crate** (`agent/` directory) — this is a local path dependency not reviewed
- **Frontend component implementation** — `main.ts` is 8000+ lines and was spot-checked but not fully reviewed
- **TTS subsystem** (`src-tauri/src/tts/mod.rs`) — only reviewed the command layer
- **Voice subsystem** (voice session management, VAD, shadow eval) — architecture reviewed but not implementation details
- **Sheets service** — 2000+ lines, spot-checked for safety but not fully audited
- **Runtime behavior** — the app was not launched or tested interactively
- **macOS and Windows specific code paths** — only Linux was available for testing
- **`cargo audit`** — not available in the environment; dependency vulnerabilities were not checked

### Confidence Levels
| Area | Confidence |
|------|-----------|
| Architecture quality | **High** |
| Security findings | **High** (all backed by code evidence) |
| Build/release readiness | **High** |
| Frontend quality | **Medium** (spot-checked, not fully reviewed) |
| Platform-specific issues | **Medium** (Linux-focused, extrapolated for others) |
| Performance characterization | **Medium** (static analysis, no profiling) |
