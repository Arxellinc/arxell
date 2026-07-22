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
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
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

Status: `not started`

- [ ] Record the hybrid PTY/RPC decision in architecture documentation.
- [ ] Decide managed versus system Pi for the first public release.
- [ ] Pin the initial supported Pi RPC protocol/package version range.
- [ ] Decide whether Arxell Pi sessions are persistent by default.
- [ ] Decide whether interactive users may opt into their normal global Pi profile.
- [ ] Capture baseline OpenCode smoke tests before changing behavior.
- [ ] Add a feature flag: `agentRuntime = "opencode" | "pi"` or equivalent.

Acceptance:

- [ ] Runtime ownership, distribution, trust, session, and rollback decisions are explicit.
- [ ] No implementation relies on process-exit behavior that is specific to OpenCode.

## Phase 1: Pi Runtime Probe And Process Foundation

Status: `in progress`

Backend tasks:

- [ ] Add a platform-neutral `PiRuntimeService` interface.
- [ ] Isolate executable discovery and process spawning in the runtime/tool layer.
- [ ] Probe with `pi --version`, not `which`, `where`, or shell output parsing.
- [ ] Resolve executables across npm, pnpm, Yarn, Bun, managed runtime, and explicit paths.
- [ ] On Windows, diagnose the Bash requirement documented by Pi.
- [ ] Add semantic version compatibility checks.
- [ ] Add start/progress/complete/error events with correlation IDs.
- [ ] Add deterministic child-process-tree shutdown.

Frontend tasks:

- [ ] Replace the OpenCode install modal with Pi runtime diagnostics.
- [ ] Prefer `npm install -g --ignore-scripts ...` over a one-click `curl | bash` flow.
- [ ] Show missing Node, npm, Bash, incompatible version, and executable-path errors separately.
- [ ] Provide Recheck and Select Executable actions.

Tests:

- [ ] Probe success/failure/incompatible-version unit tests.
- [ ] Linux/macOS/Windows command-resolution tests.
- [ ] Child cleanup tests.

Acceptance:

- [ ] Pi availability is determined without opening a PTY.
- [ ] Failures are visible and typed; no silent fallback to “not installed.”

## Phase 2: Standalone Workspace Tool Migration

Status: `in progress`

Frontend tasks:

- [ ] Create `frontend/src/tools/pi/` from the OpenCode tool structure.
- [ ] Rename state and action types from `OpenCode*` to `Pi*`.
- [ ] Register tool id `pi`, title `Pi`, and accurate description/icon.
- [ ] Preserve multi-session tabs and per-session working directories.
- [ ] Always render a Launch/New Session action, including after all sessions close.
- [ ] Wire an explicit default project root instead of inheriting process cwd.
- [ ] Deliver initial prompts correctly, using a safely quoted startup argument or a post-ready input strategy.
- [ ] Track terminal exits and update session status.
- [ ] Surface launch errors in state and UI.
- [ ] Replace custom modal/form CSS with shared Arxell classes and variables.

Backend/terminal tasks:

- [ ] Add a Pi-aware terminal launch request or a generic executable-session abstraction.
- [ ] Remove `OPENCODE_MODEL` behavior from `TerminalService`.
- [ ] Preserve `TERM=xterm-256color` and resize behavior for Pi's TUI.
- [ ] Resolve the correct Windows shell/Bash configuration.

Persistence migration:

- [ ] Map `opencode` → `pi` in frontend registry aliases.
- [ ] Map backend `tools-registry.json` records from `opencode` → `pi`.
- [ ] Map `opencode-tool` → `pi-tool` in workspace preferences.

Acceptance:

- [ ] A user can launch, interact with, switch, and close multiple Pi sessions.
- [ ] Closing every session does not leave a dead-end UI.
- [ ] Initial prompts and working directories are correct.
- [ ] Linux, macOS, and Windows setup paths are documented and tested.

## Phase 3: Rust Pi RPC Client

Status: `not started`

- [ ] Implement a dedicated child process with piped stdin/stdout/stderr.
- [ ] Start `pi --mode rpc` with explicit cwd, profile, session, trust, tools, model, and extension flags.
- [ ] Implement strict LF-only JSONL framing.
- [ ] Preserve partial UTF-8 and partial-line buffers across reads.
- [ ] Correlate command responses by RPC `id`.
- [ ] Translate Pi events into typed Arxell events.
- [ ] Treat malformed JSON, protocol mismatch, stderr, and unexpected exit as structured errors.
- [ ] Wait for `agent_settled` before declaring completion.
- [ ] Implement graceful abort, timeout, shutdown, and kill fallback.
- [ ] Add bounded buffers and output truncation.
- [ ] Support RPC extension UI requests and matching responses.

Tests:

- [ ] Fragmented JSONL records.
- [ ] Multiple records in one read.
- [ ] CRLF input tolerance.
- [ ] Unicode `U+2028`/`U+2029` inside JSON strings without record splitting.
- [ ] Out-of-order command responses by id.
- [ ] `agent_end` followed by retry before `agent_settled`.
- [ ] Timeout, abort, malformed event, and crash paths.
- [ ] Fake Pi fixture process for deterministic CI.

Acceptance:

- [ ] The Rust client can start Pi, prompt it, stream events, detect settlement, retrieve final output, and stop it without a PTY.

## Phase 4: Arxell Pi Policy Extension

Status: `not started`

- [ ] Add a bundled TypeScript extension under an Arxell-owned resource path.
- [ ] Load it explicitly; disable unrelated extension auto-discovery for automated runs.
- [ ] Enforce canonical project-folder boundaries for read/write/edit operations.
- [ ] Protect `.git`, secret files, runtime/config roots, and other configured paths.
- [ ] Detect destructive Bash patterns and request confirmation through `ctx.ui`.
- [ ] Map RPC `extension_ui_request` to Arxell modal/notification contracts.
- [ ] Fail closed when confirmation is unavailable or times out.
- [ ] Emit safe operation metadata and policy decisions.
- [ ] Add an optional terminating structured-output tool for phase summaries.

Acceptance:

- [ ] Automated Pi cannot silently write outside the approved project root through standard file tools.
- [ ] Destructive commands require explicit approval or are blocked.
- [ ] No secret or full file content appears in policy events.

## Phase 5: Looper Migration

Status: `in progress`

Backend tasks:

- [ ] Replace `check_opencode` with `check_pi`.
- [ ] Replace each phase PTY with a Pi RPC session.
- [ ] Send phase prompts using the RPC `prompt` command.
- [ ] Select provider/model through Pi's provider/model contract.
- [ ] Use `agent_settled` as the phase completion trigger.
- [ ] Obtain final assistant text and session stats for bounded phase summaries.
- [ ] Preserve existing file artifacts such as `implementation_plan.md`, `work_summary.txt`, `validation_report.txt`, `review_result.txt`, and `review_feedback.txt`.
- [ ] Preserve Planner review/questions behavior.
- [ ] Abort the active Pi RPC run on pause/stop; kill only as fallback.
- [ ] Persist Pi session identifiers/paths needed for diagnostics and recovery.
- [ ] Keep iteration and critic `SHIP`/`REVISE` semantics unchanged.

Frontend tasks:

- [ ] Replace OpenCode wording and setup UI.
- [ ] Render structured phase logs from `pi.message.delta` and `pi.tool.*` events.
- [ ] Stop depending on terminal session IDs for headless phases.
- [ ] Show provider/model, token usage, phase state, and recoverable setup errors.
- [ ] Keep logs bounded and expandable.

Migration strategy:

- [ ] Keep the existing OpenCode adapter behind the runtime feature flag during validation.
- [ ] Never run OpenCode and Pi simultaneously against the same mutable project as a shadow test.
- [ ] Shadow only probe, protocol, and read-only scenarios.

Acceptance:

- [ ] A complete Planner → Executor → Validator → Critic loop runs through Pi.
- [ ] Pause, stop, blocked questions, revision, completion, and failure all remain functional.
- [ ] Phase completion does not depend on manually quitting Pi.

## Phase 6: Chat Planning And Delegation

Status: `not started`

- [ ] Change plan metadata from `opencode` to `pi`.
- [ ] Update user-facing delegation copy to “Looper/Pi.”
- [ ] Ensure chat approval still starts only Looper through the service boundary.
- [ ] Confirm the approved canonical `projectFolder` reaches the Pi policy extension.
- [ ] Preserve correlation ID from chat → Looper → Pi RPC events.
- [ ] Surface Pi setup/model/auth failures as delegated-workflow failures with recovery actions.
- [ ] Preserve blocker questions and completion summaries.

Acceptance:

- [ ] Approved plans delegate to Pi-backed Looper with no OpenCode process involved.
- [ ] Chat continues to own planning/approval while Pi owns constrained execution.

## Phase 7: Provider, Secret, And Local Runtime Integration

Status: `not started`

- [ ] Implement provider ID/model mapping for Arxell API connections.
- [ ] Fetch secrets only in Rust at process-start boundaries.
- [ ] Pass secrets through environment variables without logging them.
- [ ] Generate temporary non-secret Pi provider/model metadata for custom endpoints.
- [ ] Connect Pi to Arxell's local LLaMA OpenAI-compatible endpoint.
- [ ] Add auth/model readiness checks before agent start.
- [ ] Clean up temporary profiles/configuration after runs.
- [ ] Ensure export/import never includes raw Pi or Arxell credentials.

Acceptance:

- [ ] Cloud and local models selected in Arxell work in Pi without duplicating plaintext secrets.
- [ ] Local-only mode produces no telemetry/update traffic.

## Phase 8: Packaging And Platform Support

Status: `not started`

- [ ] Choose and implement system or managed Pi distribution for release.
- [ ] Pin and verify the supported Pi version.
- [ ] Add managed runtime resources to Tauri packaging if selected.
- [ ] Add Windows Git Bash/custom shell diagnostics.
- [ ] Validate executable discovery for npm, pnpm, Yarn, and Bun.
- [ ] Update Linux runtime/dependency checks where needed.
- [ ] Validate macOS app bundle PATH behavior.
- [ ] Ensure process-tree termination works on every platform.
- [ ] Add license attribution for the MIT-licensed Pi dependency.

Acceptance:

- [ ] A packaged Arxell install can launch Pi without relying on an accidental development-shell PATH.

## Phase 9: Documentation, Naming, And Cleanup

Status: `not started`

- [ ] Update `README.md` tool descriptions and architecture text.
- [ ] Update `docs/ARCHITECTURE.md` and `docs/TOOLS_ARCHITECTURE.md`.
- [ ] Update IPC/contract documentation and bump contract version.
- [ ] Update chat planning/delegation documentation.
- [ ] Add user documentation for Pi installation, authentication, sessions, trust, and privacy.
- [ ] Replace OpenCode icons/assets and alt text.
- [ ] Rename remaining source identifiers and tests.
- [ ] Remove OpenCode install commands and environment variables.
- [ ] Remove compatibility aliases after the rollback window.
- [ ] Run a repository-wide case-insensitive `opencode` audit; retain only historical migration notes if desired.

Acceptance:

- [ ] Product UI and current architecture documentation no longer describe OpenCode as an active dependency.

## Phase 10: Verification And Rollout

Status: `not started`

Automated checks:

- [ ] `cd frontend && npm run build`
- [ ] `cd frontend && npm run lint`
- [ ] `cd src-tauri && cargo check`
- [ ] Rust RPC parser/process tests.
- [ ] Frontend Pi state/binding/render tests.
- [ ] Contract serialization tests.
- [ ] Fake-provider or mock-RPC Looper integration tests.

Manual smoke matrix:

- [ ] Linux interactive Pi.
- [ ] macOS interactive Pi.
- [ ] Windows interactive Pi with Git Bash.
- [ ] Multiple Pi workspace sessions.
- [ ] Initial prompt and custom cwd.
- [ ] Local model run.
- [ ] Cloud API run.
- [ ] Full Looper cycle.
- [ ] Planner blocker/question flow.
- [ ] Pause, resume, stop, and forced process termination.
- [ ] Chat plan approval → Pi-backed Looper → completion.
- [ ] Out-of-scope write rejection.
- [ ] Destructive Bash confirmation and timeout rejection.
- [ ] App shutdown with active interactive and RPC sessions.

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

- [ ] No active production path launches `opencode`.
- [ ] The workspace exposes Pi with reliable multi-session lifecycle behavior.
- [ ] Looper uses Pi RPC for every phase.
- [ ] Chat-approved delegation runs through Pi-backed Looper.
- [ ] Arxell API and local-model selections work without plaintext secret duplication.
- [ ] Project boundaries and destructive actions are policy-gated.
- [ ] Correlation IDs and structured events cover probe, prompt, tools, completion, and errors.
- [ ] Linux, macOS, and Windows smoke matrices pass.
- [ ] Contracts and current documentation contain Pi terminology.
- [ ] The OpenCode adapter and compatibility aliases are removed after the rollback window.

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
