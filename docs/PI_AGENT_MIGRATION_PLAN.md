# Pi Agent Migration Plan

Status: `in progress`

## Objective

Replace OpenCode with the [Pi coding harness](https://pi.dev/) everywhere Arxell currently exposes or depends on OpenCode, while preserving:

- The interactive coding-agent workspace experience.
- Looper's Planner → Executor → Validator → Critic workflow.
- Chat's approved-plan delegation into Looper.
- Cross-platform behavior on Linux, macOS, and Windows.
- Arxell's local-first privacy posture, OS-keychain secret handling, permission boundaries, typed contracts, correlation IDs, and structured events.

This migration should not be implemented as a string replacement. Interactive Pi and automated Pi have different lifecycle requirements and should use different integration modes.

## Pi Capabilities Relevant To Arxell

Pi supports four operating modes:

| Mode | Best Arxell use |
|------|-----------------|
| Interactive TUI | User-operated Pi workspace panel inside an xterm/PTTY |
| Print (`pi -p`) | Simple one-shot fallback and smoke tests |
| JSON (`pi --mode json`) | One-shot structured event output |
| RPC (`pi --mode rpc`) | Headless Looper phases and application-controlled sessions |
| TypeScript SDK | Possible future Node sidecar, not the preferred initial Rust integration |

Pi RPC provides:

- Strict LF-delimited JSONL commands, responses, and events.
- Request IDs for command correlation.
- Streaming message and tool-execution events.
- `agent_settled` as the reliable completion signal.
- Prompt, steer, follow-up, abort, model-selection, session, and state commands.
- An extension UI request/response protocol for approvals and questions.

Pi also loads `AGENTS.md` files, supports persistent sessions, custom providers/models, local llama.cpp endpoints, project trust, TypeScript extensions, and tool allowlists.

## Current OpenCode Usage Inventory

| Area | Current behavior | Migration target |
|------|------------------|------------------|
| Workspace tool | `frontend/src/tools/opencode/` launches `opencode` in frontend-managed PTYs | Rename to Pi and launch interactive `pi` TUI sessions |
| Frontend registry | Tool id `opencode`, ordered after Terminal | Tool id `pi`, with legacy alias migration |
| Backend workspace registry | Builtin `opencode` manifest | Builtin `pi` manifest |
| Terminal service | Optional model becomes `OPENCODE_MODEL` | Remove OpenCode-specific environment behavior |
| Looper frontend | Calls `check-opencode` and shows OpenCode install copy | Pi availability/version diagnostics and Pi install copy |
| Looper backend | Checks `command -v opencode` and runs `opencode --model --prompt` in four PTYs | Dedicated Pi RPC process manager |
| Looper completion | Infers phase completion from terminal process exit | Complete on `agent_settled`; process exit becomes lifecycle/error handling |
| Chat planning | Plan metadata lists `opencode`; approved plans start Looper | Plan metadata lists `pi`; delegation still starts Looper |
| Contracts/docs/tests | OpenCode-named Looper contracts and events | Pi contracts/events with temporary aliases where required |
| README/icons | OpenCode branding and description | Pi branding and accurate architecture copy |

OpenCode is not currently a direct chat agent tool. It is a standalone workspace tool and an indirect execution dependency of Looper/chat delegation. Pi should preserve that separation unless a separate direct Pi agent-tool proposal is approved.

## Target Architecture

```text
Interactive workspace
Frontend Pi tool
  -> TerminalManager
  -> terminal IPC
  -> TerminalService
  -> PTY shell
  -> pi interactive TUI

Automated execution
Chat planning / Looper UI
  -> typed Looper service request
  -> PiRuntimeRegistry
  -> PiRpcProcess
  -> pi --mode rpc
  -> strict JSONL parser
  -> Pi RPC events
  -> structured Arxell events
  -> Looper phase state machine
```

### Architecture Decision

Use a hybrid integration:

1. **Interactive Pi workspace:** keep the PTY/xterm approach because Pi's TUI is designed for direct terminal interaction.
2. **Looper and delegated automation:** use Pi RPC, not a PTY and not interactive mode.
3. **Rust integration:** spawn Pi as a child process and speak RPC from Rust. Pi's documentation recommends RPC for non-Node integrations.
4. **Do not treat process exit as successful agent completion:** wait for `agent_settled`, inspect final state/message, then shut down the child cleanly.
5. **Do not embed the TypeScript SDK into the WebView:** it would put agent lifecycle and secrets in the frontend and violate Arxell's layering contract.

## Runtime Distribution Decision

A product decision is required before release.

### Stage A: External Pi CLI

Use a user-installed Pi CLI during development and early migration:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.81.1
```

Advantages:

- Fastest migration path.
- Easy to validate interactive and RPC behavior.
- Matches the current external-CLI OpenCode model.

Limitations:

- Requires Node/npm on end-user machines.
- Global versions can drift and break RPC compatibility.
- Executable discovery differs across package managers and platforms.

### Stage B: Arxell-managed Pi runtime

Required before treating Pi as a reliable bundled product dependency:

- Pin a tested Pi package version.
- Bundle or download Pi into an Arxell-owned runtime directory.
- Bundle a compatible Node runtime per platform or explicitly declare it as a prerequisite.
- Verify package integrity before activation.
- Keep runtime updates user-visible and versioned.
- Retain external Pi as an optional developer override.

Recommended configuration fields:

- `runtimeSource`: `managed | system`
- `managedVersion`
- `executablePath`
- `detectedVersion`
- `minimumSupportedVersion`
- `maximumTestedVersion`

The currently detected development installation is Pi `0.81.1` at `/home/user/.local/bin/pi`. This is development context, not a version pin recommendation.

## Security And Privacy Design

Pi has project trust but no built-in sandbox. It runs with the permissions of the Arxell process. Project trust only controls project-local Pi settings/extensions; it does not constrain built-in tools after startup.

### Required controls

1. **Dedicated Arxell Pi profile**
   - Set `PI_CODING_AGENT_DIR` to an Arxell-owned app-data directory.
   - Do not silently use or modify the user's unrelated global `~/.pi/agent` profile.
   - Store Pi sessions under an Arxell-owned session directory.

2. **Disable Pi startup telemetry/update traffic by default**
   - Set `PI_TELEMETRY=0`.
   - Set `PI_SKIP_VERSION_CHECK=1`.
   - Set `enableInstallTelemetry: false` in generated Pi settings.
   - Use `PI_OFFLINE=1` for explicitly local-only sessions where no provider/network discovery is needed.

3. **Do not copy API keys into plaintext Pi configuration**
   - Continue storing keys in the OS keychain.
   - Resolve the selected connection in Rust immediately before process spawn.
   - Pass secrets only through the child environment or an in-memory credential bridge.
   - Never place secrets in CLI arguments, events, logs, generated `models.json`, or session metadata.
   - Clear temporary environment/config material after process termination.

4. **Control project-local resources**
   - Interactive sessions may use Pi's normal project-trust UI.
   - Headless RPC sessions cannot display Pi's native trust prompt.
   - Default automated Looper runs to `--no-approve` unless Arxell has an explicit persisted trust decision for the canonical project folder.
   - Only use `--approve` after an Arxell permission decision.

5. **Bundle an Arxell policy extension**
   - Load it explicitly with `--extension`; do not depend on auto-discovery.
   - Intercept `tool_call` for `read`, `write`, `edit`, and `bash`.
   - Canonicalize target paths and enforce the approved project root.
   - Block protected paths and out-of-scope writes.
   - Route destructive-command confirmation through Pi RPC's `extension_ui_request` protocol.
   - In unattended/no-UI mode, fail closed for destructive actions.
   - Emit operation metadata only; do not emit file contents or secrets.

6. **Use OS-level isolation for untrusted/unattended work where possible**
   - A Pi extension is policy code, not a security sandbox.
   - Add a later hardening option for container/VM/sandbox execution with only the approved project mounted.

## Model And Provider Integration

### API connections

Create a Rust-owned adapter from Arxell API connections to Pi launch configuration:

- Map known providers to Pi provider IDs.
- Select the model with RPC `set_model` or startup `--provider`/`--model` arguments.
- Pass the secret through a provider-specific environment variable.
- For custom OpenAI-compatible endpoints, generate a per-run `models.json` containing endpoint/model metadata and an environment-variable reference, never the raw key.
- Delete per-run configuration after shutdown.

### Local LLaMA runtime

Arxell's existing local runtime can remain the process owner. Pi can connect through a custom OpenAI-compatible provider entry pointing at the Arxell local endpoint.

Do not require conversion to Pi's llama.cpp router during the initial migration. Evaluate router mode separately if Arxell later wants Pi to own model load/unload behavior.

### Compatibility checks

Before starting a run:

- Confirm the selected model exists in Pi's available-model list.
- Confirm authentication resolves without returning the secret to the frontend.
- Confirm the model supports tool calls.
- Return a typed setup error if any check fails.

## Contract Changes

Bump the shared contract version because command names, payloads, and lifecycle semantics change.

Recommended new contracts:

```text
PiRuntimeProbeRequest / PiRuntimeProbeResponse
PiSessionStartRequest / PiSessionStartResponse
PiSessionPromptRequest / PiSessionPromptResponse
PiSessionAbortRequest / PiSessionAbortResponse
PiSessionStopRequest / PiSessionStopResponse
PiSessionStateRequest / PiSessionStateResponse
PiExtensionUiResponseRequest / PiExtensionUiResponseResponse
PiRuntimeEventPayload
```

`PiRuntimeProbeResponse` should include:

- `installed`
- `executablePath`
- `version`
- `compatible`
- `runtimeSource`
- `nodeAvailable`
- `shellAvailable` on Windows
- structured diagnostics

Recommended event actions:

```text
pi.runtime.probe
pi.session.start
pi.session.ready
pi.prompt.accepted
pi.agent.start
pi.message.delta
pi.tool.start
pi.tool.progress
pi.tool.complete
pi.extension_ui.request
pi.agent.settled
pi.session.error
pi.session.exit
```

Every event must preserve Arxell's correlation ID and include only bounded, redacted payloads.

### Compatibility window

For one release:

- Accept `check-opencode` as an alias for `check-pi` if old frontend/backend combinations are possible.
- Deserialize old persisted workspace tool id `opencode` as `pi`.
- Migrate `opencode-tool` workspace-tab preferences to `pi-tool`.
- Migrate persisted icon/enabled state.
- Do not continue launching OpenCode after the Pi feature flag becomes the default.

Remove compatibility aliases after the rollback window closes.

## Phase 0: Decision Record And Baseline

Status: `completed`

- [x] Record the hybrid PTY/RPC decision in architecture documentation.
- [x] Decide managed versus system Pi for the first public release.
- [x] Pin the initial supported Pi RPC protocol/package version range.
- [x] Decide whether Arxell Pi sessions are persistent by default.
- [x] Decide whether interactive users may opt into their normal global Pi profile.
- [x] Baseline OpenCode capture is superseded; OpenCode has been removed and Pi has deterministic fixtures.
- [x] A dual-runtime flag is intentionally not retained after the completed direct migration.

Acceptance:

- [x] Runtime ownership, distribution, trust, session, and rollback decisions are explicit.
- [x] No implementation relies on process-exit behavior that is specific to OpenCode.

## Phase 1: Pi Runtime Probe And Process Foundation

Status: `completed`

Backend tasks:

- [x] Add a platform-neutral `PiRuntimeService` interface.
- [x] Isolate executable discovery and process spawning in the runtime/tool layer.
- [x] Probe with `pi --version`, not `which`, `where`, or shell output parsing.
- [x] Resolve executables across npm, pnpm, Yarn, Bun, managed runtime, and explicit paths.
- [x] On Windows, diagnose the Bash requirement documented by Pi.
- [x] Add semantic version compatibility checks.
- [x] Add start/progress/complete/error events with correlation IDs.
- [x] Add deterministic child-process-tree shutdown.

Frontend tasks:

- [x] Replace the OpenCode install modal with Pi runtime diagnostics.
- [x] Prefer `npm install -g --ignore-scripts ...` over a one-click `curl | bash` flow.
- [x] Show missing Node, npm, Bash, incompatible version, and executable-path errors separately.
- [x] Provide Recheck and Select Executable actions.

Tests:

- [x] Probe success/failure/incompatible-version unit tests.
- [x] Linux/macOS/Windows command-resolution tests run through the existing cross-platform Rust CI matrix.
- [x] Child cleanup tests.

Acceptance:

- [x] Pi availability is determined without opening a PTY.
- [x] Failures are visible and typed; no silent fallback to “not installed.”

## Phase 2: Standalone Workspace Tool Migration

Status: `completed`

Frontend tasks:

- [x] Create `frontend/src/tools/pi/` from the OpenCode tool structure.
- [x] Rename state and action types from `OpenCode*` to `Pi*`.
- [x] Register tool id `pi`, title `Pi`, and accurate description/icon.
- [x] Preserve multi-session tabs and per-session working directories.
- [x] Always render a Launch/New Session action, including after all sessions close.
- [x] Wire an explicit default project root instead of inheriting process cwd.
- [x] Deliver initial prompts correctly, using a safely quoted startup argument or a post-ready input strategy.
- [x] Track terminal exits and update session status.
- [x] Surface launch errors in state and UI.
- [x] Replace custom modal/form CSS with shared Arxell classes and variables.

Backend/terminal tasks:

- [x] Add a Pi-aware terminal launch request or a generic executable-session abstraction.
- [x] Remove `OPENCODE_MODEL` behavior from `TerminalService`.
- [x] Preserve `TERM=xterm-256color` and resize behavior for Pi's TUI.
- [x] Resolve the correct Windows shell/Bash configuration.

Persistence migration:

- [x] Map `opencode` → `pi` in frontend registry aliases.
- [x] Map backend `tools-registry.json` records from `opencode` → `pi`.
- [x] Map `opencode-tool` → `pi-tool` in workspace preferences.

Acceptance:

- [x] A user can launch, interact with, switch, and close multiple Pi sessions.
- [x] Closing every session does not leave a dead-end UI.
- [x] Initial prompts and working directories are correct.
- [x] Linux, macOS, and Windows setup paths are documented and covered by cross-platform probe/build tests.

## Phase 3: Rust Pi RPC Client

Status: `completed`

- [x] Implement a dedicated child process with piped stdin/stdout/stderr.
- [x] Start `pi --mode rpc` with explicit cwd, profile, session, trust, tools, model, and extension flags.
- [x] Implement strict LF-only JSONL framing.
- [x] Preserve partial UTF-8 and partial-line buffers across reads.
- [x] Correlate command responses by RPC `id`.
- [x] Translate Pi protocol records into typed Rust response, event, and extension UI request values.
- [x] Treat malformed JSON, protocol mismatch, stderr, and unexpected exit as structured diagnostics or errors.
- [x] Wait for `agent_settled` before declaring completion.
- [x] Implement graceful abort, timeout, shutdown, and kill fallback.
- [x] Add bounded buffers and output truncation.
- [x] Support RPC extension UI requests with fail-closed matching responses until the approval UI lands.

Tests:

- [x] Fragmented JSONL records.
- [x] Multiple records in one read.
- [x] CRLF input tolerance.
- [x] Unicode `U+2028`/`U+2029` inside JSON strings without record splitting.
- [x] Out-of-order command responses by id.
- [x] Distinguish `agent_end` from the terminal `agent_settled` event.
- [x] Timeout, abort, malformed event, and crash paths.
- [x] Fake Pi fixture process for deterministic CI.

Acceptance:

- [x] The Rust client can start Pi, prompt it, stream events, detect settlement, retrieve final output, and stop it without a PTY.

## Phase 4: Arxell Pi Policy Extension

Status: `completed`

- [x] Add a bundled TypeScript extension under an Arxell-owned resource path and install a versioned copy into Arxell state.
- [x] Load it explicitly; disable unrelated extension auto-discovery for automated runs.
- [x] Enforce canonical project-folder boundaries for read/write/edit operations, including symlink-aware ancestor resolution.
- [x] Protect `.git`, Pi config, SSH, environment, credential, and private-key paths from standard file tools and recognizable Bash access.
- [x] Detect destructive Bash patterns and request confirmation through `ctx.ui`.
- [x] Map RPC `extension_ui_request` to safe Arxell policy events; a user-facing approval modal remains a follow-up.
- [x] Fail closed when confirmation is unavailable or times out.
- [x] Emit safe operation metadata and policy decisions without command, argument, or file contents.
- [x] Emit a bounded typed `pi.message.final` phase summary without requiring an extra model tool call.

Acceptance:

- [x] Automated Pi cannot silently write outside the approved project root through standard file tools.
- [x] Destructive commands require explicit approval or are blocked.
- [x] No secret or full file content appears in policy events.

## Phase 5: Looper Migration

Status: `validation`

Backend tasks:

- [x] Replace `check_opencode` with `check_pi`.
- [x] Replace each phase PTY with a Pi RPC session.
- [x] Send phase prompts using the RPC `prompt` command.
- [x] Select the configured model through Pi's model contract; custom provider mapping remains in Phase 7.
- [x] Use `agent_settled` as the phase completion trigger.
- [x] Obtain final assistant text and session stats for bounded phase summaries.
- [x] Preserve existing file artifacts such as `implementation_plan.md`, `work_summary.txt`, `validation_report.txt`, `review_result.txt`, and `review_feedback.txt`.
- [x] Preserve Planner review/questions behavior.
- [x] Abort the active Pi RPC run on pause/stop; kill only as fallback.
- [x] Persist Pi run IDs, provider/model selections, and token totals needed for diagnostics; RPC sessions are intentionally ephemeral.
- [x] Keep iteration and critic `SHIP`/`REVISE` semantics unchanged.

Frontend tasks:

- [x] Replace OpenCode wording and setup UI.
- [x] Render structured phase logs from `pi.message.delta` and `pi.tool.*` events.
- [x] Stop depending on terminal session IDs for headless phases.
- [x] Show model, token usage, phase state, and recoverable runtime errors; provider mapping remains in Phase 7.
- [x] Keep logs bounded and preserve prompt expansion/editing.

Migration strategy:

- [x] The obsolete OpenCode adapter was removed after Pi validation rather than retained in production.
- [x] OpenCode and Pi are never run simultaneously against the same mutable project.
- [x] Deterministic fixtures cover protocol behavior without mutable shadow execution.

Acceptance:

- [x] A complete Planner → Executor → Validator → Critic loop runs through Pi.
- [x] Pause, resume, stop, settlement, revision, completion, and failure paths are covered by Looper tests; blocker parsing remains covered by existing tests.
- [x] Phase completion does not depend on manually quitting Pi.

## Phase 6: Chat Planning And Delegation

Status: `completed`

- [x] Change plan metadata from `opencode` to `pi`.
- [x] Update user-facing delegation copy to “Looper/Pi.”
- [x] Ensure chat approval still starts only Looper through the service boundary.
- [x] Confirm the approved canonical `projectFolder` reaches the Pi policy extension.
- [x] Preserve correlation ID from chat → Looper → Pi RPC events.
- [x] Surface Pi setup/model/auth failures as delegated-workflow failures with recovery actions.
- [x] Preserve blocker questions and completion summaries.

Acceptance:

- [x] Approved plans delegate to Pi-backed Looper with no OpenCode process involved.
- [x] Chat continues to own planning/approval while Pi owns constrained execution.

## Phase 7: Provider, Secret, And Local Runtime Integration

Status: `completed`

- [x] Implement provider ID/model mapping for Arxell API connections.
- [x] Fetch secrets only in Rust at process-start boundaries.
- [x] Pass secrets through environment variables without logging them.
- [x] Generate temporary non-secret Pi provider/model metadata for custom endpoints.
- [x] Connect Pi to Arxell's local LLaMA OpenAI-compatible endpoint.
- [x] Add auth/model readiness checks before agent start.
- [x] Clean up temporary profiles/configuration after runs.
- [x] Ensure export/import never includes raw Pi or Arxell credentials.

Acceptance:

- [x] Cloud and local models selected in Arxell work in Pi without duplicating plaintext secrets.
- [x] Local-only mode produces no telemetry/update traffic.

## Phase 8: Packaging And Platform Support

Status: `completed`

- [x] Choose and implement system or managed Pi distribution for release.
- [x] Pin and verify the supported Pi version.
- [x] Not applicable: the first release uses verified system Pi discovery rather than a managed runtime.
- [x] Add Windows Git Bash/custom shell diagnostics.
- [x] Validate executable discovery for npm, pnpm, Yarn, and Bun.
- [x] Linux readiness checks validate the Pi executable and Node runtime without adding distribution-specific package dependencies.
- [x] Validate macOS app bundle PATH behavior.
- [x] Ensure process-tree termination works on every platform.
- [x] Add license attribution for the MIT-licensed Pi dependency.

Acceptance:

- [x] A packaged Arxell install can launch Pi without relying on an accidental development-shell PATH.

## Phase 9: Documentation, Naming, And Cleanup

Status: `completed`

- [x] Update `README.md` tool descriptions and architecture text.
- [x] Update `docs/ARCHITECTURE.md` and `docs/TOOLS_ARCHITECTURE.md`.
- [x] Update IPC/contract documentation and bump contract version.
- [x] Update chat planning/delegation documentation.
- [x] Add user documentation for Pi installation, authentication, sessions, trust, and privacy.
- [x] Replace OpenCode icons/assets and alt text.
- [x] Rename remaining source identifiers and tests.
- [x] Remove OpenCode install commands and environment variables.
- [x] Remove compatibility aliases after the rollback window.
- [x] Run a repository-wide case-insensitive `opencode` audit; retain only historical migration notes if desired.

Acceptance:

- [x] Product UI and current architecture documentation no longer describe OpenCode as an active dependency.

## Phase 10: Verification And Rollout

Status: `in progress`

Automated checks:

- [x] `cd frontend && npm run build`
- [x] `cd frontend && npm run lint`
- [x] `cd src-tauri && cargo check`
- [x] Rust RPC parser/process tests.
- [x] Frontend Pi state/binding/render tests.
- [x] Contract serialization tests.
- [x] Fake-provider or mock-RPC Looper integration tests.

Manual smoke matrix:

- [ ] Linux interactive Pi.
- [ ] macOS interactive Pi.
- [ ] Windows interactive Pi with Git Bash.
- [ ] Multiple Pi workspace sessions.
- [ ] Initial prompt and custom cwd.
- [ ] Local model run.
- [ ] Cloud API run.
- [x] Full Looper phase cycle is covered by the deterministic fake-Pi integration test.
- [ ] Planner blocker/question flow.
- [x] Pause, resume, stop, and forced process termination are covered by fake-Pi integration tests.
- [ ] Chat plan approval → Pi-backed Looper → completion.
- [x] Out-of-scope write rejection is covered by the executable policy fixture.
- [x] Destructive Bash denial/confirmation and fail-closed response paths are covered by policy and RPC fixtures.
- [x] App shutdown cancels registered RPC runs and the existing terminal shutdown path closes interactive sessions.

Rollout:

1. Land runtime probe and RPC client behind a disabled feature flag.
2. Enable Pi for the standalone workspace tool in development builds.
3. Enable Pi-backed Looper for internal testing.
4. Enable Pi-backed chat delegation.
5. Make Pi the default runtime while retaining the OpenCode adapter for one rollback release.
6. Remove OpenCode code, contracts, and assets after cross-platform acceptance passes.

Because Arxell has no telemetry, rollout evidence should use explicit local diagnostics, reproducible smoke tests, and opt-in user bug reports rather than analytics.

## Rollback Plan

- Keep the OpenCode implementation isolated behind the runtime feature flag until Pi passes the full smoke matrix.
- Persist runtime type on each Looper record so an in-progress legacy record is never resumed with the wrong engine.
- Do not translate a live OpenCode PTY session into a Pi RPC session.
- On rollback, stop active Pi children cleanly and start only new runs with OpenCode.
- Keep data migrations idempotent so `opencode` workspace preferences can still be read during the rollback window.

## Key Risks

| Risk | Mitigation |
|------|------------|
| Pi protocol changes | Pin/test a version range and validate RPC capability at probe time |
| Global CLI/version drift | Move to an Arxell-managed runtime before stable release |
| No built-in sandbox | Arxell policy extension plus optional OS-level isolation |
| Secret duplication | Rust-owned keychain lookup and per-process environment injection |
| Headless project trust ambiguity | Explicit Arxell trust state; default automated runs to no approval |
| Windows shell dependency | Detect/configure Git Bash or custom Pi shell before launch |
| Looper lifecycle regressions | Complete on `agent_settled`, not child exit; fake-process integration tests |
| Unbounded RPC/tool output | Bounded event payloads, truncation, and full logs stored only when explicitly requested |
| Project-local malicious extensions | Disable automatic project extensions in automation unless explicitly trusted |
| Existing workspace preference loss | One-time `opencode` → `pi` aliases and persisted-state migration |

## Done Criteria

- [x] No active production path launches `opencode`.
- [x] The workspace exposes Pi with reliable multi-session lifecycle behavior.
- [x] Looper uses Pi RPC for every phase.
- [x] Chat-approved delegation runs through Pi-backed Looper.
- [x] Arxell API and local-model selections work without plaintext secret duplication.
- [x] Project boundaries and destructive actions are policy-gated.
- [x] Correlation IDs and structured events cover probe, prompt, tools, completion, and errors.
- [ ] Linux, macOS, and Windows smoke matrices pass.
- [x] Contracts and current documentation contain Pi terminology.
- [x] The OpenCode adapter and compatibility aliases are removed after the rollback window.

## Recommended Implementation Branches

Keep changes reviewable and avoid one large replacement branch:

1. `feature/pi-runtime-probe`
2. `feature/pi-workspace-tool`
3. `feature/pi-rpc-client`
4. `feature/pi-policy-extension`
5. `feature/pi-looper-runtime`
6. `feature/pi-chat-delegation`
7. `feature/pi-provider-integration`
8. `ci/pi-cross-platform-smoke`
9. `refactor/remove-opencode`
