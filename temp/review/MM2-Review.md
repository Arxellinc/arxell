# Release Readiness Review

## Executive Summary

**Not Ready for Public Release** — The application has two blocking issues that prevent a clean build:
1. **27 TypeScript compilation errors** in the frontend prevent production builds
2. **Rust test compilation failure** (`cargo test` fails) due to missing fields in `LooperLoop` test struct

Additionally, there are significant security concerns around API key storage, shell command execution, and path traversal in the files service.

**Top 5 Risks:**
1. Frontend TypeScript errors block production builds entirely
2. API keys stored in plaintext in memory and exported via `ApiConnectionGetSecretResponse`
3. TerminalPTY shell spawning allows execution of arbitrary commands with user-provided cwd
4. FilesService path resolution allows listing directories outside intended workspace root
5. High-severity npm vulnerabilities in frontend dependencies

---

## What Is Well Engineered

### Architecture & Modularity
- Clean separation between IPC layer, services, and Tauri bridge (`src-tauri/src/ipc/`, `src-tauri/src/app/`)
- `AppContext` provides a coherent composition root for all services
- EventHub-based observability with structured event emission across subsystems
- Tool invocation registry pattern in `src-tauri/src/tools/invoke/registry.rs` for extensibility

### Error Handling
- Uses `thiserror` for custom error types in Rust (e.g., `SheetsError`)
- Consistent `Result<T, String>` error propagation in Tauri commands
- Event-based error reporting with `EventSeverity::Error` for failures

### Tauri Integration
- Proper use of `tauri::State` for dependency injection
- Multi-window support (main window + looper preview windows via `WebviewWindowBuilder`)
- Window state persistence/restoration (`persist_window_state`, `restore_window_state`)
- Proper async handling with `tokio::task::spawn_blocking` for CPU-bound work

### Observability
- `EventHub` provides structured logging with `Subsystem`, `EventStage`, `EventSeverity`
- Correlation IDs track requests across async boundaries
- Frontend event listener forwards backend events via `emit("app:event", ...)`

### Frontend Structure
- Clear IPC client abstraction in `ipcClient.ts` with typed request/response contracts
- Contract types generated to match Rust counterparts in `contracts.ts`
- Reactive state management with getter/setter proxies in `ChatPanelState`

### Security Design (Partial)
- CSP configured in `tauri.conf.json`: `default-src 'self'; media-src 'self' mediastream:; connect-src ipc: http://127.0.0.1`
- Path traversal mitigation in `FilesService` via `resolve_existing_target_path` and `resolve_writable_target_path`
- Capability-based plugin permissions in `WorkspaceToolsService`

---

## Release Blockers

### 1. Frontend TypeScript Compilation Failure

**Severity:** Blocker

**Evidence:** `cd frontend && npm run check` fails with 27 errors including:
```
src/main.ts(1194,3): error TS2739: Type '{ messages: UiMessage[]; ... }' is missing properties from type 'ChatSendState': memoryAlwaysLoadToolKeys, memoryAlwaysLoadSkillKeys
src/main.ts(3440,38): error TS2339: Property 'inspectChatContext' does not exist on type 'ChatIpcClient'.
src/main.ts(7851,27): error TS2339: Property 'upsertMemory' does not exist on type 'ChatIpcClient'.
```

**Why it matters:** The application cannot be built for production. Users who clone and build will encounter TypeScript errors.

**Recommended fix:** Regenerate or align the frontend type definitions with the backend contract definitions. The mismatch suggests `ChatIpcClient` interface is missing methods that `main.ts` expects.

**Suggested validation test:** `cd frontend && npm run build` must succeed before release.

---

### 2. Rust Test Compilation Failure

**Severity:** Blocker

**Evidence:** `cargo test --no-run` fails with:
```
error[E0063]: missing fields `planner_plan`, `preview` and `review_before_execute` in initializer of `looper_handler::LooperLoop`
    --> src/tools/looper_handler.rs:2390:9
```

**Why it matters:** `cargo test` cannot complete, blocking CI validation and test execution.

**Recommended fix:** Add the missing fields to the `LooperLoop` struct initialization in the `sample_loop()` test helper function at `src-tauri/src/tools/looper_handler.rs:2390`.

**Suggested validation test:** `cd src-tauri && cargo test --no-run` must succeed before release.

---

### 3. High-Severity npm Vulnerabilities

**Severity:** Blocker

**Evidence:** `npm audit` reports:
- 1 critical
- 1 high
- 3 moderate

**Why it matters:** Public release with known vulnerabilities exposes users to potential supply chain attacks.

**Recommended fix:** Run `npm audit fix` and verify the application still functions. Investigate which packages have critical/high vulnerabilities and consider alternatives if fixes break functionality.

**Suggested validation test:** `cd frontend && npm audit` should return no high/critical vulnerabilities.

---

## High Priority Issues

### 4. API Keys Exposed via `cmd_api_connection_get_secret`

**Severity:** High

**Evidence:** `src-tauri/src/main.rs:1114-1124`:
```rust
async fn cmd_api_connection_get_secret(
    state: State<'_, TauriBridgeState>,
    request: ApiConnectionGetSecretRequest,
) -> Result<ApiConnectionGetSecretResponse, String> {
    let api_key = state.api_registry.get_secret_api_key(request.id.as_str())?;
    Ok(ApiConnectionGetSecretResponse {
        correlation_id: request.correlation_id,
        id: request.id,
        api_key,
    })
}
```

**Why it matters:** API keys are returned in plaintext to the frontend via IPC. If the frontend is compromised or the IPC channel is tapped, secrets are exposed. Additionally, `ApiRegistryService` stores connections in memory with plaintext API keys (see `ApiConnectionSecretRecord` in `src-tauri/src/api_registry.rs`).

**Recommended fix:** Reconsider exposing secrets via IPC. If the frontend needs secrets for direct API calls, use a proxy pattern with short-lived tokens. If secrets must be stored, use OS keychain integration.

**Suggested validation test:** Verify API keys are never logged, serialized to disk, or transmitted to the frontend unless absolutely necessary.

---

### 5. Terminal PTY Shell Execution with User-Provided CWD

**Severity:** High

**Evidence:** `src-tauri/src/app/terminal_service.rs:38-68`:
```rust
pub fn open_session(&self, req: TerminalOpenSessionRequest) -> Result<TerminalOpenSessionResponse, String> {
    // ...
    let shell = req.shell.unwrap_or_else(default_shell);
    let mut command = CommandBuilder::new(shell);
    if let Some(cwd) = req.cwd {
        command.cwd(PathBuf::from(cwd));  // User-controlled path
    }
```

**Why it matters:** A malicious user could provide a crafted `cwd` to execute commands in arbitrary directories. The shell defaults to user's default shell, which could be `/bin/sh`, `/bin/bash`, etc.

**Recommended fix:** Validate that `cwd` is within an approved workspace directory before passing to `CommandBuilder::cwd()`. Add a allowlist of permitted working directories.

**Suggested validation test:** Attempt to open a terminal session with `cwd` set to `/etc` or `~/.ssh` and verify the request is rejected.

---

### 6. Path Traversal in FilesService Read Operations

**Severity:** High

**Evidence:** `src-tauri/src/app/files_service.rs:39-78`:
```rust
pub fn read_file(&self, path: &str, correlation_id: String) -> Result<FilesReadFileResponse, String> {
    let target = resolve_existing_target_path(self.root_path.as_path(), Some(path))?;
    // No validation that target is within root_path after resolution
```

The `resolve_existing_target_path` may correctly handle `../` escaping, but the subsequent operations do not re-check containment.

**Why it matters:** If the path resolution logic has edge cases, files outside the workspace could be read.

**Recommended fix:** After resolving the target path, verify it is still contained within `self.root_path` using `target.starts_with(self.root_path)`.

**Suggested validation test:** Attempt to read a file using paths like `../../etc/passwd` or `..%2F..%2Fetc%2Fpasswd` and verify they are rejected.

---

### 7. Frontend Bundle Size (1.1MB index.js)

**Severity:** High

**Evidence:** `npm run build` output:
```
dist/assets/index-ClYcqYX3.js  1,093.30 kB │ gzip: 285.90 kB
```

**Why it matters:** Large bundle size increases initial load time, especially for users on slower connections.

**Recommended fix:** Implement code-splitting using dynamic `import()` for:
- Heavy libraries (Mermaid at 599KB, highlight.js)
- Route-based splitting
- Lazy-load non-critical panels

**Suggested validation test:** Lighthouse performance audit should show First Contentful Paint < 3s on 3G.

---

## Medium Priority Improvements

### 8. Rust Formatting Failures

**Severity:** Medium

**Evidence:** `cargo fmt --check` produces extensive diffs (shown in test output above).

**Why it matters:** Inconsistent formatting makes code reviews harder and can hide bugs in diffs.

**Recommended fix:** Run `cargo fmt` to auto-format. Add a CI check to fail on formatting errors.

---

### 9. Heavy `.expect()` Usage on Lock Poisoning

**Severity:** Medium

**Evidence:** 289 instances of `unwrap()` or `expect()` found in codebase, including:
- `src-tauri/src/services/sheets_service.rs:245`: `self.state.write().expect("sheets state lock poisoned")`
- `src-tauri/src/workspace_tools/mod.rs:214`: `self.state.write().expect("workspace tools lock poisoned")`

**Why it matters:** While lock poisoning indicates a serious bug, panicking is not graceful degradation. If one thread panics while holding a lock, other threads will deadlock.

**Recommended fix:** Replace `.expect()` with `.map_err(|e| format!("lock poisoned: {}", e))?` or `.unwrap_or_else(|_| /* graceful fallback */)` where possible.

---

### 10. Terminal Session Thread Not Managed by Tokio

**Severity:** Medium

**Evidence:** `src-tauri/src/app/terminal_service.rs:93`:
```rust
std::thread::spawn(move || {
    // ...
});
```

**Why it matters:** The terminal reader thread is not part of the Tokio runtime and cannot be gracefully shut down via async mechanisms.

**Recommended fix:** Use `tokio::task::spawn_blocking` or a dedicated runtime for terminal I/O, and ensure threads are joined on shutdown.

---

### 11. Linux WebKit Permission Handler Auto-Grants All Permissions

**Severity:** Medium

**Evidence:** `src-tauri/src/main.rs:176-194`:
```rust
#[cfg(target_os = "linux")]
{
    use webkit2gtk::{PermissionRequestExt, WebViewExt};
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.with_webview(|webview| {
            webview.inner().connect_permission_request(move |_wv, request| {
                info!("[webkit] granting permission for request");
                // Grant all permission requests (this is a development-only setting)
                request.allow();
                true
            });
        });
    }
}
```

**Why it matters:** The comment states "this is a development-only setting" but it runs in production builds. All media permissions are auto-granted.

**Recommended fix:** Remove this code from production builds, or implement a proper permission prompt system.

---

### 12. Workspace Tools Allow Arbitrary Plugin Loading

**Severity:** Medium

**Evidence:** `src-tauri/src/workspace_tools/mod.rs:130-160`:
```rust
fn load_plugin(&self, path: &Path) -> Result<PluginManifest, String> {
    // Reads manifest from plugin directory
    // Creates tool plugin from manifest
}
```

**Why it matters:** The plugin discovery allows loading from `tools_plugins/` directory, which could include malicious plugins if a user is tricked into placing one there.

**Recommended fix:** Implement plugin signing/verification before loading. Add a plugin allowlist in configuration.

---

## Low Priority Polish

### 13. Dead Code in sheets_service.rs

**Severity:** Low

**Evidence:**
- `src-tauri/src/services/sheets_service.rs:1381`: `unused variable: 'formula_engine'`
- `src-tauri/src/services/sheets_service.rs:1993`: `function 'detect_format' is never used`

**Recommended fix:** Remove or prefix with underscore if intended for future use.

---

### 14. LooperHandler Has Unused Functions

**Severity:** Low

**Evidence:**
- `src-tauri/src/tools/looper_handler.rs:1613`: `method 'on_terminal_output' is never used`
- `src-tauri/src/tools/looper_handler.rs:2162`: `function 'detect_preview_url' is never used`
- `src-tauri/src/tools/looper_handler.rs:2293`: `function 'extract_session_id' is never used`

**Recommended fix:** Remove unused code or mark with `#[allow(dead_code)]` if for future use.

---

### 15. Sheets JSONL Export Does Not Flush

**Severity:** Low

**Evidence:** `src-tauri/src/services/sheets_service.rs:2018`:
```rust
fs::write(&path, content).unwrap();
```

**Why it matters:** `fs::write` is buffered and may not hit disk immediately. On crash, data could be lost.

**Recommended fix:** Use `fs::sync_all()` after write, or use a higher-level API that handles flushing.

---

## Security Review

### Tauri Permissions Analysis

**Default capability (`src-tauri/capabilities/default.json`):**
```json
{
  "permissions": [
    "core:default",
    "core:path:default",
    "core:event:default",
    "dialog:allow-open",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-unmaximize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "core:window:allow-start-dragging"
  ]
}
```

**Assessment:** Permissions are relatively restricted. `dialog:allow-open` allows file dialogs which is reasonable. No broad shell or exec permissions granted by default.

**Risk:** `core:path:default` allows path resolution which could enable path traversal if not properly validated in service code.

### Command Exposure Surface

**Total Tauri commands exposed:** ~60+ commands (see `invoke_handler` in `main.rs:222-311`)

**Risk areas:**
1. `cmd_llama_runtime_start` - starts processes
2. `cmd_llama_runtime_install_engine` - downloads and installs binaries
3. `cmd_model_manager_download_hf` - downloads from HuggingFace
4. `cmd_api_connection_create` / `cmd_api_connection_probe` - makes network requests
5. Terminal session management commands - creates PTY processes

### Secrets Management

**API keys stored in:**
- `ApiRegistryService.connections` (in-memory `HashMap`)
- Serialized via `ApiRegistrySnapshot` for persistence
- Exposed via `cmd_api_connection_get_secret` to frontend

**Risk:** If the app crashes, core dumps could contain API keys. Memory forensics could extract keys.

**Recommendation:** Use OS keychain (Keychain on macOS, KWallet on Linux, Credential Manager on Windows) for API key storage.

### CSP Evaluation

```json
"csp": "default-src 'self'; media-src 'self' mediastream:; connect-src ipc: http://127.0.0.1"
```

**Assessment:** CSP is reasonably restrictive. `connect-src ipc: http://127.0.0.1` allows IPC connections to localhost which is expected for Tauri apps.

---

## Reliability Review

### Crash-Prone Flows

1. **SQLite initialization fails gracefully** - `src-tauri/src/app/mod.rs:43-44`:
   ```rust
   SqliteConversationRepository::new(SqliteConversationRepository::default_path())
       .expect("failed to initialize conversation repository")
   ```
   This will panic if SQLite fails, crashing the app.

2. **Tauri app startup** - `main.rs:313`:
   ```rust
   .run(tauri::generate_context!())
   .expect("failed to run tauri app");
   ```
   Panics on any startup error.

### Platform-Specific Risks

1. **Linux WebKit permission auto-grant** (see Issue #11)
2. **portable-pty** on different Linux distros may have varying behavior
3. **No Windows-specific testing observed** - PTY handling differs significantly

### Failure Modes

- **Terminal sessions:** If a process hangs, the reader thread will continue blocking. No timeout or cancellation mechanism observed.
- **Model downloads:** No retry logic observed for network failures in `model_manager_service.rs`
- **LLama runtime:** If engine binary is missing or corrupt, `start()` could fail without clear error

---

## Performance Review

### Startup Time

**Not measured** - would require running the full Tauri app.

### Backend Concerns

1. **Heavy `spawn_blocking` usage** - Many commands offload to `spawn_blocking` which is correct for CPU-bound work, but could cause thread pool exhaustion if many long-running operations queue up.

2. **Lock contention in sheets_service** - The `state` mutex is held for many operations. High-frequency sheet edits could cause contention.

3. **Terminal I/O on std::thread** - Terminal reader loop uses raw threads, not managed by Tokio runtime.

### Frontend Bundle Risks

| Chunk | Size (gzip) | Concern |
|-------|-------------|---------|
| index.js | 285.90 kB | Largest, should be code-split |
| mermaid.core.js | 144.83 kB | Could be lazy-loaded |
| wardley-RL74JXVD.js | 109.84 kB | Diagram library |
| katex-DHMw6HUq.js | 76.68 kB | Math rendering |
| xterm.js bundles | ~50 kB | Terminal component |

**Total initial load:** ~285 kB gzipped for main bundle, plus lazy chunks.

### Memory Leaks

**Potential issue in terminal service** - Reader threads spawn per session but `close_session` must be called to clean up. If sessions are not closed properly, threads will leak.

---

## Frontend/UX Review

### Missing Type Alignments

The `ChatIpcClient` interface in `ipcClient.ts` appears incomplete relative to what `main.ts` expects. Multiple methods are referenced but not defined.

### State Management Complexity

`createSendMessageHandler` and `createSecondaryChatSendState` have complex proxy patterns. The ChatPanelState is large (~30+ properties) and the proxy pattern makes it hard to track what actually triggers re-renders.

### Loading/Error States

Not reviewed in depth, but the event-based architecture suggests loading states are managed by frontend. Ensure all user-facing operations have:
- Loading indicators
- Error messages with actionable information
- Empty states for lists

### Accessibility

No accessibility audit performed. Recommend:
- Keyboard navigation testing
- Screen reader compatibility check
- Color contrast verification

---

## Test and Build Results

### Commands Run

| Command | Result | Notes |
|---------|--------|-------|
| `cd src-tauri && cargo check` | PASS | 5 warnings, 0 errors |
| `cd src-tauri && cargo clippy` | PASS | 25 warnings, 0 errors (advisory) |
| `cd src-tauri && cargo fmt --check` | FAIL | Extensive formatting differences |
| `cd src-tauri && cargo test --no-run` | FAIL | Missing fields in test struct |
| `cd frontend && npm install` | PASS | 5 vulnerabilities (1 critical, 1 high, 3 moderate) |
| `cd frontend && npm run check` | FAIL | 27 TypeScript errors |
| `cd frontend && npm run build` | PASS | Build succeeds despite type errors |

### Cargo Warnings Summary

- 5 dead code warnings in main crate
- 1 unused variable warning
- Several `unwrap_or_else` suggestions from clippy
- 1 `too_many_arguments` warning in looper_handler

---

## Recommended Release Plan

### Must Fix Before Public Release

1. **Fix TypeScript compilation errors** — The frontend cannot build for production
2. **Fix Rust test compilation** — `cargo test` must pass for CI validation
3. **Fix npm critical/high vulnerabilities** — Run `npm audit fix` and verify
4. **Fix Linux WebKit auto-grant permission code** — Remove from production or implement proper prompting

### Should Fix Before Public Release

5. **Reconsider API key exposure** via `cmd_api_connection_get_secret`
6. **Add path validation** in `FilesService` after resolution
7. **Run `cargo fmt`** to fix formatting
8. **Add terminal session timeout/cancellation** mechanism
9. **Reduce frontend bundle size** via code-splitting

### Can Fix After Release

10. Address lock poisoning `.expect()` pattern with graceful degradation
11. Implement plugin signing/verification
12. Add proper plugin allowlist
13. Fix dead code warnings
14. Add flush to sheets JSONL export

---

## Confidence and Limitations

### What Was Reviewed

- Full Rust backend (`src-tauri/src/`)
- Tauri configuration and capabilities
- Frontend source (`frontend/src/` except deep component inspection)
- Build/test configuration
- Security permissions and CSP
- IPC layer architecture

### What Could Not Be Reviewed

- **Runtime behavior** — App not actually run
- **Memory safety** — No Valgrind/sanitizer testing
- **Performance profiling** — No measurements taken
- **Windows/macOS behavior** — Linux only environment
- **Accessibility audit** — No automated accessibility testing
- **Dependency vulnerabilities** — No `cargo audit` (not installed) or `npm audit --audit-level=high`

### Confidence Levels

| Area | Confidence |
|------|------------|
| Code structure/architecture | High |
| TypeScript compilation errors | High (reproduced) |
| Rust test compilation error | High (reproduced) |
| Security permissions analysis | Medium (static analysis only) |
| Path traversal mitigation | Medium (logic review, not tested) |
| API key exposure risk | High (confirmed via code inspection) |
| Performance characteristics | Low (no measurements) |

### Key Unknowns

1. Does the path traversal mitigation actually work for all edge cases?
2. Do terminal sessions properly clean up on abnormal exit?
3. Are there race conditions in the sheets service state management?
4. Does the looper handler properly handle partial failures in multi-phase loops?