# Release Readiness Review

## Executive Summary
This app is not ready for public release yet.

Top 5 risks:
1. The Rust backend does not pass the required verification baseline: `cargo test --features tauri-runtime` fails to compile because `LooperLoop` initializers are missing new fields in `src-tauri/src/tools/looper_handler.rs:2390`.
2. The frontend release gate is broken: `npm run check` and `npm test` both fail with concrete TypeScript/API mismatches in `frontend/src/main.ts` and `frontend/src/tools/sheets/state.ts`.
3. Linux builds currently auto-grant all WebKit permission requests in production code, including media permissions, in `src-tauri/src/main.rs:176-191`.
4. API secrets are stored and exported in plaintext and can be retrieved back into the renderer through `cmd_api_connection_get_secret` (`src-tauri/src/api_registry.rs:447-470`, `src-tauri/src/main.rs:1114-1123`).
5. Release packaging is not coherent yet: Tauri bundling is disabled in `src-tauri/tauri.conf.json:28-38`, and the CI workflow still uploads `app-foundation` artifacts even though the package is `arxell-lite` (`.github/workflows/build-desktop.yml:24-35`, `554-562`).

## What Is Well Engineered
- The repo has a clear intended layering model documented in `docs/ARCHITECTURE.md`, and the code generally follows that split between frontend, IPC, services, and tool dispatch.
- Filesystem path handling in `src-tauri/src/app/files_service.rs` is stronger than average: it canonicalizes the workspace root, rejects traversal outside the workspace (`197-229`), and uses separate logic for existing vs. writable paths.
- Model deletion is guarded carefully in `src-tauri/src/app/model_manager_service.rs:314-345` by canonicalizing the models directory and refusing deletion outside it.
- The GitHub Actions workflow includes safe tar extraction checks for bundled runtime assets in `.github/workflows/build-desktop.yml:135-149` and `308-315`.
- The app CSP is at least intentionally constrained to self and localhost IPC traffic in `src-tauri/tauri.conf.json:24-26`, which is better than leaving it unset.
- Several blocking operations are correctly pushed to worker threads from Tauri commands, for example microphone probing and model-manager work via `tokio::task::spawn_blocking` in `src-tauri/src/main.rs:1152-1155`, `1262-1444`.

## Release Blockers

### 1. Broken Rust verification baseline
- Severity: Blocker
- Evidence: `cargo test --features tauri-runtime` fails with `missing fields 'planner_plan', 'preview' and 'review_before_execute' in initializer of 'LooperLoop'` at `src-tauri/src/tools/looper_handler.rs:2390`.
- Why it matters: the backend test target does not compile, so the release branch is already below a minimum shippable bar. This also strongly suggests unchecked structural drift in the looper code.
- Recommended fix: make the test/build target compile again, then rerun `cargo test`, `cargo check`, and `cargo clippy` on the release configuration.
- Suggested validation test: `cargo test --features tauri-runtime` passes cleanly in CI and locally.

### 2. Broken frontend typecheck and test pipeline
- Severity: Blocker
- Evidence: `npm run check` fails with missing `ChatIpcClient` methods and state fields in `frontend/src/main.ts` including `inspectChatContext` (`3440`), `modelManagerRefreshUnslothCatalog` (`4278`), `upsertMemory` (`7851`), `createSkill` (`7865`), `deleteMemory` (`7975`), and missing `memoryAlwaysLoadToolKeys` / `memoryAlwaysLoadSkillKeys` in the state returned from `createSecondaryChatSendState` (`1191-1249`). `npm test` also fails with unresolved/import/type issues including `frontend/tests/sheetsTool.test.ts` and `frontend/src/tools/sheets/state.ts:423-425`.
- Why it matters: the shipped frontend is not type-safe, test coverage is not runnable, and important chat/memory flows are demonstrably out of sync with the IPC client.
- Recommended fix: restore interface parity between `frontend/src/main.ts`, `frontend/src/ipcClient.ts`, and the contracts; then fix the sheets typing errors and test fixture drift.
- Suggested validation test: `npm run check` and `npm test` both pass in CI and from a fresh checkout.

### 3. Linux auto-approves all WebKit permission requests
- Severity: Blocker
- Evidence: `src-tauri/src/main.rs:176-191` installs a Linux WebKit permission handler that calls `request.allow();` for every permission request, with the comment `Grant all permission requests (this is a development-only setting)`.
- Why it matters: this removes the user-consent boundary for microphone and any other WebKit permission requests on Linux. For a public release, that is an avoidable security and trust failure.
- Recommended fix: remove the blanket allow handler before release, or replace it with explicit, least-privilege gating limited to the exact permission types and user actions required.
- Suggested validation test: on Linux, microphone permission requires an explicit user-driven flow and unrelated permission requests are denied.

### 4. Secret handling is not release-safe
- Severity: Blocker
- Evidence: API keys are persisted in plaintext JSON via `serde_json::to_string_pretty` and `fs::write` in `src-tauri/src/api_registry.rs:447-470`; exports also include raw `api_key` values in `291-320`; the renderer can fetch full secrets through `cmd_api_connection_get_secret` in `src-tauri/src/main.rs:1114-1123`, and the frontend uses that to repopulate edit forms in `frontend/src/main.ts:5144-5168`.
- Why it matters: this contradicts the architecture doc claim that API keys are encrypted (`docs/ARCHITECTURE.md:60-62`), increases blast radius for any renderer compromise, and makes exports extremely sensitive by default.
- Recommended fix: store secrets in an OS-backed credential store or encrypt at rest with a protected key, stop exporting raw keys by default, and remove or tightly constrain the full-secret IPC path.
- Suggested validation test: inspect persisted app data and exported connection files to confirm secrets are not stored in plaintext; verify editing a connection does not require returning the raw key to the renderer.

### 5. Release packaging configuration is not production-ready
- Severity: Blocker
- Evidence: `src-tauri/tauri.conf.json:28-38` has `"bundle": { "active": false }`, so normal Tauri packaging is disabled. The CI workflow builds `arxell-lite` but uploads `src-tauri/target/release/app-foundation` / `app-foundation.exe` in `.github/workflows/build-desktop.yml:24-35, 554-562`, which does not match the Rust package name.
- Why it matters: the release workflow is likely to fail artifact upload or produce ad hoc binaries instead of proper desktop packages. There is also no signing/updater configuration in `tauri.conf.json`.
- Recommended fix: align CI artifact names with the actual binary/package outputs, enable and validate proper Tauri bundling for target platforms, and decide on signing/updater strategy before public release.
- Suggested validation test: run the full GitHub Actions release workflow on a tag and verify that all platform artifacts upload successfully and can be installed on clean machines.

## High Priority Issues
- `cargo clippy --features tauri-runtime --all-targets -- -D warnings` fails with a large backlog of lint violations across core modules, including duplicated cfg attributes, unused imports, stale tests, and structural warnings in chat/STT/TTS/sheets code. This is not itself a release blocker, but it indicates the branch is carrying significant maintenance debt.
- Tauri exposes a very large backend surface directly through `tauri::generate_handler!` in `src-tauri/src/main.rs:222-310`, including terminal control, model download/runtime control, file operations via tool invoke, secret retrieval, STT/TTS lifecycle, and plugin/custom capability invocations. There is no capabilities-based least-privilege policy checked into `src-tauri` beyond a generated schema file.
- `cmd_terminal_open_session` exposes arbitrary shell spawning to the renderer (`src-tauri/src/main.rs:729+`, `src-tauri/src/app/terminal_service.rs:38-126`). `TerminalOpenSessionRequest` allows caller-controlled `shell`, `cwd`, and environment-derived execution. That may be intentional for a developer tool, but it materially raises the consequence of any XSS or renderer compromise.
- The frontend entrypoint is a very large monolith: `frontend/src/main.ts` is over 8,700 lines and currently centralizes UI rendering, state wiring, IPC usage, and feature orchestration. That is already contributing to interface drift and verification failures.
- `EventHub` only redacts a few exact top-level keys in object payloads (`src-tauri/src/observability.rs:82-93`). Nested secrets or differently named credential fields will pass through unchanged.

## Medium Priority Improvements
- `AppContext::new()` can panic on startup if the SQLite conversation repository cannot initialize because it uses `.expect("failed to initialize conversation repository")` in `src-tauri/src/app/mod.rs:42-45`. A release build should degrade gracefully and surface a recoverable error.
- The Linux WebKit permission logic is commented as development-only but is compiled unconditionally under `target_os = "linux"`. That mismatch itself is a process smell.
- `PermissionService::probe_microphone_inner()` uses `std::thread::sleep` (`src-tauri/src/app/permission_service.rs:134`) and `TerminalService` uses dedicated OS threads for session output (`src-tauri/src/app/terminal_service.rs:93`). These are acceptable in isolation, but the project should keep auditing for blocking behavior because many services are sync-heavy.
- Root-level release/onboarding docs are thin. There is no repository `README` with clean build, run, packaging, and troubleshooting steps.
- The release workflow downloads large runtime assets directly from upstream latest releases during CI. That is convenient, but it weakens reproducibility unless versions are pinned and checksummed in source control.

## Low Priority Polish
- `frontend/src/main.ts` uses several `innerHTML` render paths (`2970`, `3544`, `6565`, `7188`). Some appear to feed controlled/generated markup, but these should be reviewed systematically and documented to keep trust high.
- `frontend/vite.config.ts` is very minimal. Manual chunking or explicit optimization strategy would help keep bundle growth under control.
- Several architecture docs are stronger than the current implementation reality, especially around encrypted secret storage and clean layering. Tightening docs to match shipping behavior would reduce user surprise.

## Security Review
- Confirmed issue: Linux permission auto-grant in `src-tauri/src/main.rs:176-191` is release-blocking.
- Confirmed issue: API keys are stored in plaintext JSON and exported in plaintext in `src-tauri/src/api_registry.rs:291-320` and `447-470`.
- Confirmed issue: raw API keys are retrievable by the renderer through `cmd_api_connection_get_secret` in `src-tauri/src/main.rs:1114-1123` and used in `frontend/src/main.ts:5144-5168`.
- Confirmed issue: the Tauri command surface is broad, with no checked-in capability policy limiting which windows/webviews can call which commands.
- Confirmed positive: file-path traversal defenses in `src-tauri/src/app/files_service.rs:197-229` and model deletion guards in `src-tauri/src/app/model_manager_service.rs:314-345` are solid.
- Confirmed positive: the app CSP in `src-tauri/tauri.conf.json:24-26` is restrictive relative to many desktop apps.
- Suspected risk: `cmd_terminal_open_session` and `cmd_tool_invoke` together make the renderer a very powerful control plane. That is expected for an AI dev tool, but for public release the threat model should explicitly assume renderer compromise and justify this exposure.
- Limitation: `cargo audit` could not be run because `cargo-audit` is not installed in this environment.

## Reliability Review
- Confirmed issue: backend tests do not compile.
- Confirmed issue: frontend typecheck and unit tests do not pass.
- Confirmed issue: CI artifact paths appear stale (`app-foundation`) relative to the actual package name (`arxell-lite`).
- Confirmed issue: startup can panic if the SQLite repo fails to initialize (`src-tauri/src/app/mod.rs:42-45`).
- Confirmed gap: there is no evidence in the checked-in workflow that Rust tests, clippy, or frontend typechecks/tests gate release; the workflow mainly builds artifacts.
- Platform note: the workflow downloads and repackages large platform-specific runtimes dynamically at build time, which increases failure modes for CI and platform drift.

## Performance Review
- Frontend production build succeeds, but the main bundle is large: `dist/assets/index-*.js` is about 1.09 MB minified / 285.90 kB gzip, and several Mermaid-related chunks are very large (`frontend` build output). This is a real startup/perf risk.
- Vite reports ineffective code-splitting for `frontend/src/tools/opencode/actions.ts` and `frontend/src/tools/looper/actions.ts` because those modules are both dynamically and statically imported.
- Backend performance is mixed: several heavyweight operations still use synchronous `reqwest::blocking`, `std::fs`, and process management, but many Tauri entrypoints correctly push that work behind `spawn_blocking`.
- `frontend/src/main.ts` size and centralization increase rerender/debug cost and make performance regressions harder to isolate.

## Frontend/UX Review
- The frontend currently has basic architecture strain rather than polish strain: a monolithic `frontend/src/main.ts`, broken type contracts, and failing tests make regression risk high before release.
- There is evidence of some failure-state handling, for example `loadMemoryContext()` wraps errors and updates UI state in `frontend/src/main.ts:3435-3458`.
- There is not enough evidence from static review alone to certify accessibility or responsive behavior end-to-end. I did not perform manual UI interaction across desktop/mobile breakpoints.
- The current release candidate likely has user-visible issues in memory/chat/editor flows because the code that consumes those APIs is already out of sync with `ChatIpcClient`.

## Test and Build Results
- `cargo check --features tauri-runtime` from `src-tauri`: Passed with warnings. Warnings included unused variable `formula_engine` in `src/services/sheets_service.rs:1381` and dead code `detect_format` in `src/services/sheets_service.rs:1993`.
- `cargo clippy --features tauri-runtime --all-targets -- -D warnings` from `src-tauri`: Failed. Key failures included duplicated cfg attributes (`src/ipc/tauri_bridge.rs:1`, `src/ipc/tool_runtime.rs:1`, `src/tools/invoke/mod.rs:1`, `src/tts/mod.rs:1`), missing `LooperLoop` fields in tests (`src/tools/looper_handler.rs:2390`), and many warning-level issues escalated to errors.
- `cargo test --features tauri-runtime` from `src-tauri`: Failed. Compile error at `src/tools/looper_handler.rs:2390` due to missing `planner_plan`, `preview`, and `review_before_execute` fields.
- `cargo fmt --check` from `src-tauri`: Failed. Output was large/truncated, but it reported formatting diffs across many Rust files.
- `npm run check` from `frontend`: Failed. Type errors in `frontend/src/main.ts`, plus sheet-state typing errors in `frontend/src/tools/sheets/state.ts:423-425`.
- `npm run build` from `frontend`: Passed. Build completed in about 7 seconds, but Vite warned about ineffective dynamic imports and chunks larger than 500 kB.
- `npm test` from `frontend`: Failed. Type/test fixture errors including `frontend/src/tools/sheets/state.ts:423-425`, missing state fields in `tests/sendMessageBootstrap.test.ts:56`, missing module `../src/tools/sheets/gridMapping.js`, and missing bindings methods in `tests/sheetsTool.test.ts`.
- `cargo audit` from `src-tauri`: Could not run because the `cargo-audit` subcommand is not installed in this environment.

## Recommended Release Plan
1. Must fix before public release
1. Restore a green verification baseline: `cargo test`, `npm run check`, and `npm test` must all pass.
2. Remove Linux blanket WebKit permission auto-approval.
3. Replace plaintext secret persistence/export and eliminate raw-secret round-tripping to the renderer.
4. Fix release packaging: enable/validate Tauri bundles, correct CI artifact paths, and test the tagged release workflow.
5. Add at least one clean-release smoke pass on Linux, macOS, and Windows installers/binaries.

2. Should fix before public release
1. Reduce Tauri command exposure or add capability-based restrictions per window/use case.
2. Decide and implement signing/updater strategy.
3. Make startup/storage failures recoverable instead of panicking.
4. Reduce frontend bundle size and resolve ineffective code splitting.
5. Add or improve root release/install documentation.

3. Can fix after release
1. Shrink `frontend/src/main.ts` into smaller feature modules.
2. Improve observability redaction to handle nested/variant secret fields.
3. Triage the broader clippy backlog once the branch is stable.

## Confidence and Limitations
- Reviewed: repository structure, architecture docs, Tauri config, Rust package config, key backend services, IPC bridge/command registration, frontend package/build config, CI workflow, and representative frontend state/IPC wiring.
- Commands run: `cargo check --features tauri-runtime`, `cargo clippy --features tauri-runtime --all-targets -- -D warnings`, `cargo test --features tauri-runtime`, `cargo fmt --check`, `npm run check`, `npm run build`, `npm test`, and `cargo audit` attempt.
- Not reviewed exhaustively: every Rust module line-by-line, every frontend component/tool path, packaged app behavior on all three desktop platforms, and live runtime behavior of STT/TTS/model downloads.
- Confidence: high on build/test/release-pipeline findings and the Linux permission issue; high on secret-storage findings; medium on broader UX/accessibility and runtime performance because those were assessed statically rather than through manual app use.
