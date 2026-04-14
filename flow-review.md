# Flow Tool Audit

## Executive Summary

The flow tool is high risk. It is registered and visible, and the generic `toolInvoke` path can start runs, but the implementation does not reliably orchestrate a Ralph Loop that can complete arbitrary tasks from the Create Project modal. The current design is a thin frontend modal plus a Rust loop over named phases. It relies on user-provided shell commands for implementation, direct filesystem mutation for planning, direct `bash` and `git2` side effects, and ad hoc LLM calls. It does not integrate with the existing agent loop as an agent capability, does not route tool side effects through the project tool registry, and does not enforce `ToolMode` or workspace-tool enablement for backend invokes.

The most serious issues are architectural rather than cosmetic: the frontend performs project creation side effects, the backend service directly executes shell/git/filesystem/network work, cancellation cannot stop blocking work, persisted active runs can strand the system, and the UI exposes pause/nudge/model-recovery controls whose backend semantics are weaker than the affordances imply. The code passes the current TypeScript and Rust tests, but those tests do not exercise the end-to-end flow contract, state restoration, cancellation, mode/policy boundaries, Create Project modal, or real IPC payloads.

Validation performed during audit:

- `npm run -s check` in `frontend`: passed.
- `cargo test --quiet` in `src-tauri`: passed, with only 8 non-ignored Rust tests and no flow end-to-end tests.

## Overall Risk Assessment

Risk: **critical** for using Flow as an autonomous Ralph Loop. It can create files and run commands, but it is not a reliable orchestration system. It has multiple paths where a user can believe a run is stopped, paused, validated, committed, or scaffolded while the backend either continues hidden work, records divergent state, or performs side effects outside the intended registry/policy boundary.

Primary failure modes:

- Arbitrary task completion is not implemented as an agent loop.
- Flow can run shell/git side effects despite `mode: "sandbox"`.
- Stop/pause/nudge controls are not reliable under blocking LLM, shell, validation, or git work.
- Workspace-root semantics differ between the files tool and the flow service.
- Create Project is implemented in frontend glue and can produce false scaffolds rather than a validated project flow.
- Flow invoke actions are not gated by workspace-tool enablement.

## Architectural Findings

### [CRITICAL] Flow is not an actual Ralph Loop for arbitrary task completion

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `frontend/src/main.ts`, `src-tauri/src/app/chat_service.rs`, `src-tauri/src/agent_tools/mod.rs`
* Functions / symbols: `FlowService::run_loop`, `FlowService::execute_step`, `createProjectSetup`, `agent_tool_bindings`
* Problem: The implementation is a fixed phase runner, not a general agent loop. It selects a checklist item, optionally calls an LLM for investigation/planning, and requires a user-provided `implementCommand` to do actual work. There is no Flow agent tool, no chat-agent orchestration, no iterative model/tool loop, and no bridge from the Create Project modal to a running agent that can complete arbitrary tasks.
* Evidence: `FLOW_BUILD_STEPS` is a fixed array (`orient`, `read_plan`, `select_task`, `investigate`, `implement`, `validate`, `update_plan`, `commit`, `push`) in `src-tauri/src/app/flow_service.rs:28`. The `implement` step returns `"Dry run: implementation skipped"` when `dryRun` is true and otherwise errors unless `implementCommand` is provided, then runs that command via shell (`src-tauri/src/app/flow_service.rs:744-772`). Agent bindings only include files, terminal, webSearch, and chart; no flow capability is exposed (`src-tauri/src/app/chat_service.rs:109-127`, `src-tauri/src/agent_tools/mod.rs:1-2`). The modal only writes starter files and optionally creates a plugin placeholder (`frontend/src/main.ts:5896-5943`).
* Impact: A user can create a project and press Start, but Flow will usually only inspect/update a plan or fail at validation/implementation. It cannot autonomously complete arbitrary tasks unless an external command already implements the needed agent behavior.
* Fix: Define Flow as a service-level orchestrator that calls the existing agent runtime or a dedicated Ralph Loop engine. The loop should own task selection, model calls, tool calls, validation, plan updates, cancellation, and persistence as one state machine. Treat `implementCommand` as an optional adapter, not the core implementation mechanism.
* Scope: architectural
* Could affect other tools: yes, if other generated tools expose ambitious agent-like UI without backend capability.
* Follow-up tests: End-to-end Create Project -> start Flow -> one task implemented -> validation -> plan updated, with mocked agent/tool calls.

### [HIGH] Create Project side effects live in frontend glue instead of the Flow service

* Confidence: high
* Files: `frontend/src/main.ts`, `docs/ARCHITECTURE.md`, `docs/TOOLS_ARCHITECTURE.md`
* Functions / symbols: `createProjectSetup`, `writeWorkspaceFile`, `writeGeneratedAppToolScaffold`
* Problem: The frontend writes plan, prompt, specs, README, and creates plugin scaffolds by directly invoking the files and workspace plugin commands. The architecture docs state frontend should be pure rendering/user interaction and must not contain business or persistence logic.
* Evidence: `docs/ARCHITECTURE.md:8-18` says frontend is pure rendering and services own orchestration/state. `createProjectSetup` builds project bodies and writes files in `frontend/src/main.ts:5896-5943`. `writeWorkspaceFile` calls `toolInvoke("files", "write-file")` from frontend glue (`frontend/src/main.ts:5748-5755`). `writeGeneratedAppToolScaffold` calls `createWorkspaceAppPlugin` from the same frontend closure (`frontend/src/main.ts:5769-5788`).
* Impact: Project creation is not transactional, not reusable by backend/agent flows, not observable as Flow service state, and can partially write artifacts before failing. It also hard-codes product semantics in a 6k-line app bootstrap file.
* Fix: Move Create Project into a typed `flow.create-project` invoke action implemented by `FlowService` or a dedicated project service. It should validate inputs, write files atomically where possible, return created artifact paths, emit structured events, and refresh workspace tools explicitly after plugin creation.
* Scope: architectural
* Could affect other tools: yes, this is a pattern for frontend bypassing service boundaries.
* Follow-up tests: IPC contract test for `flow.create-project`, partial failure rollback or recovery test, frontend modal test that only sends typed requests.

### [CRITICAL] Flow service bypasses the tool registry and performs direct side effects

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `docs/ARCHITECTURE.md`, `docs/GUARDRAILS.md`, `src-tauri/src/tools/registry.rs`
* Functions / symbols: `FlowService::execute_step`, `run_shell_command`, `perform_native_git_commit`, `perform_native_git_push`, `resolve_workspace_path`
* Problem: The service layer directly performs filesystem reads/writes, shell execution, git commit/push, directory walking, and network LLM calls. The architecture contract says services must call tools through registry indirection and must not perform direct tool-side effects.
* Evidence: `docs/ARCHITECTURE.md:16-23` says services orchestrate and call tools only through registry. Forbidden dependencies include services -> tools directly (`docs/ARCHITECTURE.md:37-41`). Flow reads/writes files directly (`src-tauri/src/app/flow_service.rs:861-889`), executes `bash -lc` (`src-tauri/src/app/flow_service.rs:1903-1909`), commits/pushes through `git2` (`src-tauri/src/app/flow_service.rs:2206-2299`), and calls `reqwest::blocking` directly (`src-tauri/src/app/flow_service.rs:1439-1461`).
* Impact: Policy checks, mode restrictions, capability boundaries, path safety, auditability, and test seams are bypassed. Flow can behave differently from the files and terminal tools over the same workspace.
* Fix: Split side effects into typed tool modules or existing services behind registry-dispatched actions. Flow should request `files.read/write`, `terminal.run` or command-runner actions, `git.commit/push`, and `llm.complete` through explicit policy-aware interfaces.
* Scope: architectural
* Could affect other tools: yes, any service doing direct platform side effects violates the same boundary.
* Follow-up tests: Architecture invariant tests or static checks that `app/*_service.rs` cannot call `Command::new`, `std::fs::write`, or `git2` except in approved modules.

### [HIGH] Backend has two incompatible tool registry concepts, and Flow uses the thinner one

* Confidence: high
* Files: `src-tauri/src/tools/registry.rs`, `src-tauri/src/tools/tool.rs`, `src-tauri/src/tools/invoke/registry.rs`, `src-tauri/src/ipc/tool_runtime.rs`, `src-tauri/src/tools/invoke/flow.rs`
* Functions / symbols: `ToolRegistry`, `Tool` trait, `InvokeRegistry`, `invoke_tool`, `invoke_start`
* Problem: The stated architecture describes one policy/dispatch gateway and a common tool trait, but generic invoke uses a separate `InvokeRegistry` of function pointers. Flow handlers call `FlowCommandHandler`, which calls `FlowService`; they do not use `ToolRegistry` or the `Tool` trait at all.
* Evidence: `ToolRegistry` and `Tool` exist in `src-tauri/src/tools/registry.rs:10-65` and `src-tauri/src/tools/tool.rs:14-17`. Generic invoke builds `InvokeRegistry` instead (`src-tauri/src/ipc/tool_runtime.rs:40-43`, `src-tauri/src/tools/invoke/mod.rs:10-15`). Flow invoke handlers clone `state.flow_handler` and call methods directly (`src-tauri/src/tools/invoke/flow.rs:29-96`).
* Impact: Registry policy is fragmented. A tool can be registered as a workspace/invoke feature without implementing the common trait or sharing policy checks.
* Fix: Reconcile the registries. Either make `InvokeRegistry` the documented policy gateway and delete/retire `ToolRegistry`, or implement Flow as a `Tool` and route invokes through one registry that enforces mode, enablement, policy, observability, and payload validation.
* Scope: architectural
* Could affect other tools: yes, files and webSearch invoke handlers use the same separate registry.
* Follow-up tests: One test that proves every builtin invoke tool is discoverable through the canonical registry and policy is applied before execution.

## Frontend Findings

### [HIGH] Create Project modal does not start or reconcile a Flow run

* Confidence: high
* Files: `frontend/src/tools/flow/index.tsx`, `frontend/src/tools/flow/bindings.ts`, `frontend/src/main.ts`
* Functions / symbols: `renderFlowToolBody`, `handleFlowClick`, `createProjectSetup`
* Problem: The modal title and copy imply project setup for Flow, but pressing Create Project only writes scaffolding and closes the modal. It does not start a Ralph Loop, does not validate the scaffold, and does not sync the generated project settings into a backend run.
* Evidence: The modal button emits `data-flow-action="create-project-setup"` (`frontend/src/tools/flow/index.tsx:421-423`). The handler calls `deps.createProjectSetup(...)` and closes the modal (`frontend/src/tools/flow/bindings.ts:147-165`). The implementation writes files/plugins and sets a message but never calls `startFlowRun` (`frontend/src/main.ts:5896-5943`).
* Impact: User intent in the Create Project modal is disconnected from execution. A new user can believe the tool is orchestrating a project when it only created starter files.
* Fix: Add an explicit “Create” versus “Create and Run” state, or make the modal call a backend `create-project-and-start` action that returns both created artifacts and a `runId`. Show backend-confirmed run status before closing.
* Scope: local plus architectural
* Could affect other tools: yes, any modal that performs setup but not its advertised workflow.
* Follow-up tests: Frontend interaction test that clicking Create either starts Flow or clearly leaves Flow idle with accurate copy.

### [MEDIUM] Event copy copies the wrong row after reversing the list

* Confidence: high
* Files: `frontend/src/tools/flow/index.tsx`, `frontend/src/tools/flow/bindings.ts`
* Functions / symbols: `renderEventRows`, `handleFlowClick`
* Problem: The renderer reverses events for display and stores the reversed index in `data-flow-event-index`, but the click handler indexes into `slice.flowFilteredEvents`, which is not reversed in the same way.
* Evidence: `renderEventRows` does `events.slice(-120).reverse().map((event, idx) => ... data-flow-event-index="${idx}")` (`frontend/src/tools/flow/index.tsx:236-250`). `handleFlowClick` reads that index and uses `slice.flowFilteredEvents[index]` (`frontend/src/tools/flow/bindings.ts:172-181`). `state.flowFilteredEvents` is set to `filteredFlow.forInspector` in `frontend/src/main.ts:1927-1928`, while rendered rows receive `filteredFlow.forRender` in `frontend/src/main.ts:2040`.
* Impact: The UI can copy a different event payload than the row the user clicked, which is especially dangerous when inspecting failures or secret-bearing events.
* Fix: Put a stable event id/correlation+timestamp/action tuple in the button, or pass the same reversed array to both renderer and copy handler. Simpler: set `data-flow-event-index` from the original array index before reversing.
* Scope: local
* Could affect other tools: no direct evidence.
* Follow-up tests: Unit test for `renderEventRows` + copy selection with three events.

### [MEDIUM] Flow embeds the Files tool without isolating files state or actions

* Confidence: high
* Files: `frontend/src/tools/host/viewBuilder.ts`, `frontend/src/tools/flow/index.tsx`, `frontend/src/tools/host/workspaceDispatch.ts`
* Functions / symbols: `buildWorkspaceToolViews`, `renderFlowToolBody`, `dispatchWorkspaceToolClick`
* Problem: Flow renders the same Files tool body inside its own workspace (`embeddedFilesHtml`) and relies on global files handlers/state. This creates hidden coupling between the Files tab and Flow tab.
* Evidence: `buildWorkspaceToolViews` renders `filesBodyHtml` once and passes it into Flow as `embeddedFilesHtml` (`frontend/src/tools/host/viewBuilder.ts:131-172`, `frontend/src/tools/host/viewBuilder.ts:303`, `frontend/src/tools/host/viewBuilder.ts:348`). Flow inserts it directly (`frontend/src/tools/flow/index.tsx:367-369`). Workspace dispatch is global and invokes flow/files handlers in sequence (`frontend/src/tools/host/workspaceDispatch.ts:112-132`).
* Impact: Opening, selecting, editing, or saving files in Flow mutates the same files state as the standalone Files tool. This may be intentional, but it is undocumented and not scoped; failures in one tool can affect the other.
* Fix: Make the coupling explicit. Either extract a reusable file explorer component with a defined shared state contract, or give Flow its own file-view slice and adapter. Document whether Flow edits are the same files workspace or a per-run project workspace.
* Scope: architectural
* Could affect other tools: yes, any tool embedding another tool’s rendered HTML.
* Follow-up tests: Switching between Files and Flow preserves selection intentionally and does not double-fire file actions.

### [MEDIUM] Flow busy state is set without immediate rerender

* Confidence: medium
* Files: `frontend/src/tools/flow/actions.ts`, `frontend/src/app/workspaceInteractions.ts`
* Functions / symbols: `startFlowRun`, `stopFlowRun`, `rerunFlowValidation`, `handleWorkspacePaneClickPrelude`
* Problem: Flow actions set `slice.flowBusy = true`, then await IPC before the delegated click handler rerenders. The UI may not show a busy/disabled state until the async operation completes.
* Evidence: `startFlowRun` sets `flowBusy` before `await deps.client.toolInvoke` (`frontend/src/tools/flow/actions.ts:11-23`). The click prelude awaits `dispatchWorkspaceToolClick` and only then calls `rerender` (`frontend/src/app/workspaceInteractions.ts:268-270`).
* Impact: Users can see stale enabled controls during long starts/stops/reruns and may double-click or issue contradictory actions. The in-memory `flowBusy` guard helps if the second event reaches the same state object, but the UX is misleading.
* Fix: Provide an action lifecycle hook or call `rerender` immediately after setting busy and again after completion. Alternatively return a “state changed before await” signal from handlers.
* Scope: local/host architectural
* Could affect other tools: yes, any async tool action using the same delegated click pattern.
* Follow-up tests: Slow mocked `toolInvoke` test asserts toolbar disables immediately after click.

### [MEDIUM] Create Project dismissal is transient and will reappear every app session

* Confidence: high
* Files: `frontend/src/main.ts`, `frontend/src/tools/flow/bindings.ts`, `frontend/src/app/persistence.ts`
* Functions / symbols: `maybeOpenFlowProjectSetup`, `skip-project-setup`, `persistFlowWorkspacePrefs`
* Problem: `flowProjectSetupDismissed` is only in memory. If the plan file does not exist, the modal can return after restart even if the user skipped it.
* Evidence: State default is `flowProjectSetupDismissed: false` (`frontend/src/main.ts:637-638`). `skip-project-setup` sets it true (`frontend/src/tools/flow/bindings.ts:167-170`). `persistFlowWorkspacePrefs` only persists advanced/bottom/split/phase/autoFollow (`frontend/src/app/persistence.ts:366-378`).
* Impact: Repeated modal prompts can interrupt users who intentionally use Flow without the generated project scaffold.
* Fix: Persist dismissal per workspace root and plan path, not globally. Reset only when the workspace root or `flowPlanPath` changes.
* Scope: local
* Could affect other tools: yes, setup modals may share the same transient-dismissal bug.
* Follow-up tests: Restart/localStorage test for skip behavior.

### [LOW] Toolbar exposes retry/resume semantics that do not resume the same run

* Confidence: high
* Files: `frontend/src/tools/flow/actions.ts`, `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `retryFlowRun`, `resumeFlowRun`, `FlowService::start`
* Problem: Retry and resume both create new runs. `resumeFlowRun` only computes remaining iterations from a previous record and starts a fresh run; it does not preserve prior selected task, per-step context, validation results, or partial state.
* Evidence: `resumeFlowRun` applies settings, calculates remaining, then calls `startFlowRun` (`frontend/src/tools/flow/actions.ts:144-155`). Backend `start` always creates a new `run_id` and empty `iterations` (`src-tauri/src/app/flow_service.rs:117-184`).
* Impact: Users may believe a stopped/failed run continues where it left off, but it restarts from the current plan and may select a different task.
* Fix: Rename to “Start new from settings” or implement true resume with a backend `resume` action that carries prior run id, completed steps, selected task, and idempotent phase behavior.
* Scope: local plus backend
* Could affect other tools: no direct evidence.
* Follow-up tests: Resume test asserting either new-run copy semantics in UI copy or true backend resume semantics.

## Backend Findings

### [CRITICAL] `ToolMode` is ignored, so sandbox requests can execute shell, git, network, and filesystem side effects

* Confidence: high
* Files: `frontend/src/tools/flow/actions.ts`, `src-tauri/src/ipc/tool_runtime.rs`, `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `ToolInvokeRequest.mode`, `invoke_tool`, `FlowService::execute_step`
* Problem: The frontend sends `mode: "sandbox"` for all Flow invokes, but backend invoke dispatch never enforces mode. Flow can run `bash -lc`, write files, commit, and push while the request mode says sandbox.
* Evidence: `startFlowRun` sends `mode: "sandbox"` (`frontend/src/tools/flow/actions.ts:17-23`). `invoke_tool` looks up only `(tool_id, action)` and passes only `request.payload` to the handler (`src-tauri/src/ipc/tool_runtime.rs:42-44`). Flow executes shell/git/filesystem work later without seeing `mode` (`src-tauri/src/app/flow_service.rs:744-772`, `src-tauri/src/app/flow_service.rs:861-889`, `src-tauri/src/app/flow_service.rs:2206-2299`).
* Impact: The mode field is a false security boundary. A caller can invoke Flow as sandbox and still trigger unrestricted local side effects.
* Fix: Pass the full `ToolInvokeRequest` into handlers or enforce mode in `invoke_tool` before dispatch. Define action capability requirements: `start` with `dryRun=false` or `autoPush=true` should require explicit non-sandbox mode and user approval/policy. Persist the accepted mode into the run record.
* Scope: architectural
* Could affect other tools: yes, all invoke tools currently share this mode gap.
* Follow-up tests: A `mode: "sandbox"` flow start with `dryRun=false` must be rejected before run creation.

### [CRITICAL] Stop/cancel cannot interrupt blocking work and can be overwritten by the run loop

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `FlowService::stop`, `FlowService::run_loop`, `run_shell_command`, `llm_generate_text`, `finish_run`
* Problem: Cancellation is a `watch` flag checked between phases. It cannot interrupt `reqwest::blocking`, `bash -lc`, validation commands, native git commit, or native git push. `stop` also mutates the run to stopped immediately, while the running task can later call `finish_run` and overwrite status.
* Evidence: `stop` sends on a watch channel and marks the record stopped (`src-tauri/src/app/flow_service.rs:218-239`). `run_loop` checks `cancel_rx` only before iterations and steps (`src-tauri/src/app/flow_service.rs:499-546`). Step execution then calls blocking LLM/shell/git functions (`src-tauri/src/app/flow_service.rs:571-578`, `src-tauri/src/app/flow_service.rs:1439-1461`, `src-tauri/src/app/flow_service.rs:1903-1909`, `src-tauri/src/app/flow_service.rs:2206-2299`). `finish_run` unconditionally sets status and summary (`src-tauri/src/app/flow_service.rs:1091-1112`).
* Impact: A user can click Stop and see a stopped state while a shell command, LLM request, commit, or push continues. Later events can flip the run to succeeded/failed. This is a serious reliability and safety issue.
* Fix: Make every long-running operation cancellation-aware. Use async process management with child kill, async HTTP with cancellation/timeout, and pre/post status guards so a stopped run cannot be overwritten. `finish_run` should compare-and-swap from running/queued and no-op if already terminal unless explicitly forced.
* Scope: architectural
* Could affect other tools: yes, terminal/process integrations may need the same cancellation model.
* Follow-up tests: Start a run with a long command, stop it, assert child process exits and final status remains stopped.

### [HIGH] Pause and nudge are much weaker than the UI implies

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `frontend/src/tools/flow/bindings.ts`, `frontend/src/tools/flow/actions.ts`
* Functions / symbols: `FlowService::pause`, `wait_if_paused`, `FlowService::nudge`, `recent_nudges`, `llm_select_task`, `llm_investigate`
* Problem: Pause is only checked between steps and before fallback switching. Nudge is stored and only included in select-task and investigation LLM prompts; it cannot redirect running shell/validation/git work and is not used by `implement`, `validate`, `update_plan`, `commit`, or `push`.
* Evidence: `pause` only updates `paused_run_ids` (`src-tauri/src/app/flow_service.rs:273-304`). `wait_if_paused` is called around iteration/step boundaries (`src-tauri/src/app/flow_service.rs:499-546`). Nudges are stored in `nudges_by_run` (`src-tauri/src/app/flow_service.rs:307-341`) and consumed by prompts in `llm_select_task` and `llm_investigate` (`src-tauri/src/app/flow_service.rs:1272-1291`, `src-tauri/src/app/flow_service.rs:1339-1355`).
* Impact: The UI can say “Pause Run” or “Nudge” even when the backend cannot act until much later, or ever for non-LLM phases.
* Fix: Expose accurate state: “pause requested” and “nudge queued”. Add cooperative cancellation/nudge hooks inside LLM prompts, command runner, validation loop, and plan update. Store pause/nudge events in persisted run state with timestamps and consumed status.
* Scope: architectural
* Could affect other tools: no direct evidence.
* Follow-up tests: Nudge during select-task changes the next prompt; nudge during validation is either rejected as unsupported or causes a documented queued effect.

### [HIGH] Persisted active runs can strand Flow after restart

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `new_with_registry`, `start`, `stop`, `finish_run`
* Problem: On startup, Flow loads runs and sets `active_run_id` from any queued/running record, but it cannot resume the spawned task or recreate cancel senders. A persisted running record blocks new starts. Stopping it emits an error because no cancel sender exists, even though it may mark the record stopped.
* Evidence: `new_with_registry` sets `active_run_id` from persisted queued/running runs but initializes `cancel_senders` empty (`src-tauri/src/app/flow_service.rs:96-112`). `start` rejects if any run is queued/running (`src-tauri/src/app/flow_service.rs:151-157`). `stop` sets `stopped` only if a sender exists (`src-tauri/src/app/flow_service.rs:223-227`) but separately marks the record stopped (`src-tauri/src/app/flow_service.rs:228-239`) and emits `flow.run.error` if `stopped` is false (`src-tauri/src/app/flow_service.rs:242-264`).
* Impact: App restart during a run can leave the user blocked from starting new flows until they issue a confusing stop that reports failure. No recovery path differentiates “orphaned active run” from a live task.
* Fix: On startup, mark persisted queued/running runs as `stopped` or `failed` with summary “Interrupted by app restart”, unless there is a durable run executor that can resume them. Emit a recovery event and persist it.
* Scope: backend
* Could affect other tools: yes, any persisted long-running operation without durable executor.
* Follow-up tests: Create a persisted running run, construct service, assert it becomes terminal or resumable and does not block `start`.

### [HIGH] Flow workspace paths do not share FilesService root or path safety

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `src-tauri/src/app/files_service.rs`
* Functions / symbols: `resolve_workspace_path`, `default_workspace_root`, `resolve_existing_target_path`, `resolve_writable_target_path`
* Problem: Flow resolves paths against `std::env::current_dir()` and allows absolute paths. FilesService resolves workspace root more carefully, treating `src-tauri` as a special case and enforcing canonical root containment.
* Evidence: Flow `resolve_workspace_path` joins relative paths to current dir and accepts absolute paths (`src-tauri/src/app/flow_service.rs:1781-1788`). FilesService uses `default_workspace_root` that maps `src-tauri` to parent repo (`src-tauri/src/app/files_service.rs:163-170`) and rejects paths outside root (`src-tauri/src/app/files_service.rs:197-229`).
* Impact: The Create Project modal can write artifacts through FilesService to one root, while Flow reads/writes/commits from another root. Absolute `planPath` or `specsGlob` can make Flow read/write outside the workspace.
* Fix: Inject `FilesService` root or a `WorkspaceRootService` into Flow. Resolve all Flow paths through the same canonical root and reject absolute/outside paths unless explicitly approved.
* Scope: architectural
* Could affect other tools: yes, any backend service resolving `current_dir` independently.
* Follow-up tests: Run from `src-tauri` cwd and repo root; Flow and FilesService must resolve the same `IMPLEMENTATION_PLAN.md`.

### [HIGH] Persistence silently drops failures and corrupt data

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `load_runs`, `persist_runs`, `finish_run`, `update_step_state`
* Problem: Flow persistence ignores directory creation and write errors, and load parse failures become an empty run list. Callers cannot know that run state was not saved.
* Evidence: `persist_runs` uses `let _ = create_dir_all`, `if let Ok(json)`, and `let _ = write` (`src-tauri/src/app/flow_service.rs:1722-1731`). `load_runs` returns `vec![]` on read or parse error (`src-tauri/src/app/flow_service.rs:1713-1719`). State mutators call `persist_runs` without checking errors (`src-tauri/src/app/flow_service.rs:184`, `src-tauri/src/app/flow_service.rs:1017`, `src-tauri/src/app/flow_service.rs:1111`, `src-tauri/src/app/flow_service.rs:1693`).
* Impact: A disk or schema error can erase visible run history or make state appear saved when it is not. Recovery and auditability are weak.
* Fix: Return `Result` from persistence functions. Emit structured error events and surface UI errors. Keep a `.bak` on parse failure instead of silently returning empty state.
* Scope: backend
* Could affect other tools: yes, similar silent persistence patterns should be audited.
* Follow-up tests: Write permission failure and malformed JSON tests.

### [HIGH] Native git commit is enabled by default and stages everything

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `flow_git_native_enabled`, `perform_native_git_commit`, `execute_step`
* Problem: In build mode with `dryRun=false`, Flow commits by default because `FLOW_GIT_NATIVE_V1` defaults to enabled. The commit stages all files with `index.add_all(["*"])`, not just Flow-owned changes.
* Evidence: `flow_git_native_enabled` returns true when the env var is missing (`src-tauri/src/app/flow_service.rs:1957-1965`). The `commit` step calls native git unless dry-run or native git disabled (`src-tauri/src/app/flow_service.rs:896-939`). `perform_native_git_commit` stages `["*"]` (`src-tauri/src/app/flow_service.rs:2206-2213`).
* Impact: Flow can commit unrelated user changes. In a dirty worktree, this is dangerous and hard to undo.
* Fix: Default native git to disabled. Require explicit UI opt-in per run. Capture a pre-run status snapshot and only stage files Flow touched, or present a diff for approval.
* Scope: backend/security
* Could affect other tools: yes, any automation that stages all repo changes.
* Follow-up tests: Dirty worktree with unrelated file must not be committed by Flow.

## IPC / Invoke Contract Findings

### [HIGH] Flow invoke is not gated by workspace tool enablement

* Confidence: high
* Files: `src-tauri/src/ipc/tool_runtime.rs`, `src-tauri/src/tools/invoke/flow.rs`, `src-tauri/src/workspace_tools/mod.rs`, `docs/TOOLS_ARCHITECTURE.md`
* Functions / symbols: `invoke_tool`, `InvokeRegistry::get`, `WorkspaceToolsService::set_enabled`
* Problem: Disabling Flow in the workspace registry does not prevent `cmd_tool_invoke` with `toolId: "flow"` from starting or controlling runs.
* Evidence: `WorkspaceToolsService` tracks enabled state (`src-tauri/src/workspace_tools/mod.rs:190-200`). `invoke_tool` dispatches solely by tool id/action and never checks `workspace_tools` (`src-tauri/src/ipc/tool_runtime.rs:36-56`). Flow registers actions unconditionally (`src-tauri/src/tools/invoke/flow.rs:11-27`).
* Impact: Tool manager disablement is not a policy boundary. Hidden or disabled Flow can still execute side effects via IPC.
* Fix: Add enablement checks in `invoke_tool` for workspace-owned tool ids before handler dispatch, with explicit exceptions for core tools. Return structured disabled errors.
* Scope: architectural
* Could affect other tools: yes, files and webSearch invoke actions have the same issue.
* Follow-up tests: Disable Flow, invoke `flow.start`, assert rejection before service call.

### [MEDIUM] Tool invoke responses are cast without validation on the frontend

* Confidence: high
* Files: `frontend/src/tools/flow/actions.ts`, `frontend/src/tools/host/flowRefresh.ts`, `frontend/src/tools/flow/runtime.ts`
* Functions / symbols: `startFlowRun`, `rerunFlowValidation`, `refreshFlowRunsFromToolInvoke`
* Problem: Frontend code casts `invokeResponse.data` to expected shapes without runtime validation. Missing or malformed fields become `undefined` state, stale messages, or exceptions later.
* Evidence: `startFlowRun` casts to `{ runId: string }` and assigns `response.runId` (`frontend/src/tools/flow/actions.ts:27-30`). `rerunFlowValidation` casts response and reads `response.results.length` (`frontend/src/tools/flow/actions.ts:181-188`). `refreshFlowRunsFromToolInvoke` casts to `{ runs: FlowRunRecord[] }` and maps it (`frontend/src/tools/host/flowRefresh.ts:32-33`).
* Impact: Contract drift can break UI state silently or with unhelpful errors. This matters because Flow crosses generated TS/Rust contracts and uses untyped JSON in the invoke registry.
* Fix: Add small runtime validators for Flow invoke responses. Fail with user-visible structured messages if `runId`, `runs`, or `results` are missing.
* Scope: local
* Could affect other tools: yes, web/files generic invokes likely share this pattern.
* Follow-up tests: Mock malformed `ToolInvokeResponse` data and assert graceful UI error.

### [MEDIUM] Legacy Flow commands are still registered but incomplete

* Confidence: high
* Files: `src-tauri/src/main.rs`, `src-tauri/src/tools/invoke/flow.rs`
* Functions / symbols: `cmd_flow_start`, `cmd_flow_stop`, `cmd_flow_status`, `cmd_flow_list_runs`, `cmd_flow_rerun_validation`, `invoke_pause`, `invoke_nudge`
* Problem: Legacy command wrappers exist for start/stop/status/list/rerun but not pause/nudge. New capabilities are generic-only while old capabilities remain exposed.
* Evidence: Tauri handler registers legacy Flow commands through `cmd_flow_rerun_validation` only (`src-tauri/src/main.rs:248-252`). Generic Flow registers pause/nudge aliases (`src-tauri/src/tools/invoke/flow.rs:15-20`).
* Impact: External callers using the legacy command surface cannot pause or nudge runs. The project also carries two command paths with divergent capability coverage.
* Fix: Remove legacy wrappers after migration, or add explicit deprecation tests and wrappers for every supported Flow action until removal.
* Scope: local
* Could affect other tools: yes, files has a legacy wrapper too.
* Follow-up tests: Command registry parity test between documented Flow actions and exposed commands.

## Workspace Tool Integration Findings

### [MEDIUM] Frontend and backend manifests match ids but the description is misleading

* Confidence: high
* Files: `frontend/src/tools/flow/manifest.ts`, `src-tauri/src/workspace_tools/mod.rs`, `frontend/src/tools/registry.ts`, `frontend/src/tools/host/viewBuilder.ts`
* Functions / symbols: `flowToolManifest`, `WORKSPACE_TOOL_MANIFESTS`, `PREFERRED_TOOL_ORDER`, `buildWorkspaceToolViews`
* Problem: Registration is present and id-consistent (`flow`), but the description says “Node-based workflow orchestration surface” while the UI/backend are not node-based and do not render a graph.
* Evidence: Frontend manifest declares id `flow` and description in `frontend/src/tools/flow/manifest.ts:3-12`. Backend manifest matches id/description in `src-tauri/src/workspace_tools/mod.rs:54-61`. Registry order includes `flow` (`frontend/src/tools/registry.ts:42-51`). View builder renders `flow` (`frontend/src/tools/host/viewBuilder.ts:259-350`).
* Impact: Discovery works, but the metadata overpromises a node-based surface. This can mask missing implementation because the tool appears fully registered.
* Fix: Update title/description to actual behavior, or implement the node/run graph. Add a manifest/view parity test so registration cannot imply completeness.
* Scope: local
* Could affect other tools: yes, generated manifests can overstate capabilities.
* Follow-up tests: Snapshot test for expected manifests and implemented views.

### [MEDIUM] Create-app-tool scaffold produces a placeholder plugin with misleading Flow plan context

* Confidence: high
* Files: `frontend/src/main.ts`, `src-tauri/src/workspace_tools/mod.rs`
* Functions / symbols: `createProjectSetup`, `writeGeneratedAppToolScaffold`, `WorkspaceToolsService::create_app_tool_plugin`
* Problem: For `projectType === "app-tool"`, Flow creates a plugin directory immediately, but the generated implementation plan tells the agent to build a plugin/custom tool. The backend scaffold writes placeholder `index.html`/`main.js` and grants only `files.read`.
* Evidence: Frontend app-tool context says “Build as a runtime plugin/custom tool…” (`frontend/src/main.ts:5911-5914`) and then calls `writeGeneratedAppToolScaffold` (`frontend/src/main.ts:5935-5937`). Backend writes placeholder plugin files and `permissions.json` with `["files.read"]` (`src-tauri/src/workspace_tools/mod.rs:271-305`).
* Impact: The tool manager can show a “ready” tool that is only a placeholder before Flow has implemented it. This is a false positive integration state.
* Fix: Either do not create the plugin until implementation has produced real files, or mark generated scaffolds as `draft`/`incomplete` and surface that status. Include needed capabilities only after explicit planning and user approval.
* Scope: architectural
* Could affect other tools: yes, generated plugin scaffolding can misreport readiness.
* Follow-up tests: Generated app-tool is disabled/draft until required files pass validation.

## Agent Tool Integration Findings

### [HIGH] Flow has no agent-tool integration despite being categorized as an agent tool

* Confidence: high
* Files: `src-tauri/src/agent_tools/mod.rs`, `src-tauri/src/app/chat_service.rs`, `frontend/src/tools/flow/manifest.ts`, `src-tauri/src/workspace_tools/mod.rs`
* Functions / symbols: `agent_tool_bindings`, `flowToolManifest`, `WORKSPACE_TOOL_MANIFESTS`
* Problem: Flow is categorized as `agent` in both frontend/backend manifests, but the chat agent cannot call Flow and Flow cannot call the chat agent through a capability.
* Evidence: Flow category is `agent` (`frontend/src/tools/flow/manifest.ts:8`, `src-tauri/src/workspace_tools/mod.rs:58`). Agent tools only include `chart` and `web_search` modules (`src-tauri/src/agent_tools/mod.rs:1-2`). Binding table contains files, terminal, webSearch, chart only (`src-tauri/src/app/chat_service.rs:109-127`).
* Impact: The Flow workspace tool and the chat agent runtime are separate systems. Users expecting agent orchestration from Flow will not get it.
* Fix: Decide the intended relationship. If Flow should orchestrate the agent, implement a controlled `flow_*` agent tool or service adapter. If not, move Flow out of category `agent` and update UX copy.
* Scope: architectural
* Could affect other tools: yes, category/agent exposure mismatch can affect generated tools.
* Follow-up tests: Enabling/disabling Flow changes agent-visible tool list only if Flow intentionally has agent tools.

## State-Management Findings

### [HIGH] Pause state is global, not per run or backend-hydrated

* Confidence: high
* Files: `frontend/src/tools/flow/state.ts`, `frontend/src/tools/flow/bindings.ts`, `frontend/src/tools/flow/actions.ts`, `src-tauri/src/contracts.rs`
* Functions / symbols: `flowPaused`, `toggle-paused-run`, `FlowRunRecord`
* Problem: `flowPaused` is a single frontend boolean. `FlowRunRecord` does not include paused state, and `list-runs` cannot hydrate pause state after refresh/reopen or run selection.
* Evidence: `FlowRuntimeSlice` contains `flowPaused: boolean` (`frontend/src/tools/flow/state.ts:66`). Toggle uses `!slice.flowPaused` for the active run (`frontend/src/tools/flow/bindings.ts:90-94`). Rust `FlowRunRecord` has no paused field (`src-tauri/src/contracts.rs:1131-1153`). Backend pause state is stored separately in `paused_run_ids` and not persisted (`src-tauri/src/app/flow_service.rs:47-53`, `src-tauri/src/app/flow_service.rs:273-304`).
* Impact: Selecting a different run can show the wrong pause label. Refresh/restart loses pause state. A paused run can appear resumed or vice versa.
* Fix: Add `paused` or `pauseRequested` to `FlowRunRecord` and persist it. Make UI pause state derive from active run, not a global flag.
* Scope: local plus contract
* Could affect other tools: no direct evidence.
* Follow-up tests: Pause one run, select another, refresh, and assert labels are correct.

### [MEDIUM] Event-derived run state and refreshed backend state can race each other

* Confidence: medium
* Files: `frontend/src/tools/host/flowEvents.ts`, `frontend/src/tools/host/flowRefresh.ts`, `frontend/src/tools/flow/runtime.ts`
* Functions / symbols: `applyFlowRuntimeEvent`, `createFlowRunsRefreshScheduler`, `refreshFlowRunsFromToolInvoke`, `applyFlowEvent`
* Problem: Every flow event mutates local state and schedules a list-runs refresh 250ms later. Refresh replaces `flowRuns` wholesale with backend records. This can overwrite event-derived details or reintroduce stale backend data if persistence/write lag or list failure occurs.
* Evidence: `applyFlowRuntimeEvent` calls `applyFlowEvent` and schedules refresh for any `flow.*` event (`frontend/src/tools/host/flowEvents.ts:5-13`). Refresh assigns `slice.flowRuns = response.runs.map(...)` (`frontend/src/tools/host/flowRefresh.ts:32-33`).
* Impact: UI can flicker, lose optimistic phase details, or show inconsistent validation/active run data. The design has two truths for run state.
* Fix: Choose one canonical source. Prefer backend snapshots plus event stream offsets, or event-sourced frontend state with periodic reconciliation that merges by run/iteration/step instead of replacing.
* Scope: architectural
* Could affect other tools: yes, event+poll hybrids need reconciliation rules.
* Follow-up tests: Simulated out-of-order events and delayed list response should not regress status.

### [MEDIUM] Validation results are not scoped by run and iteration

* Confidence: high
* Files: `frontend/src/tools/flow/runtime.ts`, `frontend/src/tools/flow/bindings.ts`
* Functions / symbols: `applyFlowEvent`, `flowValidationResults`, `select-run`
* Problem: `flowValidationResults` is a single array. Progress updates dedupe only by command string. Results from different runs or iterations can collide if they use the same command.
* Evidence: Validation progress does `findIndex(item.command === parsed.command)` (`frontend/src/tools/flow/runtime.ts:251-267`). Selecting a run clears all validation results rather than loading that run’s validation output (`frontend/src/tools/flow/bindings.ts:44-47`).
* Impact: Validation table can show stale, missing, or overwritten results across runs/iterations.
* Fix: Store validation results by `{runId, iteration, command}`. Derive active table from active run/iteration. Include validation results in `FlowRunRecord` or reconstruct from step payloads.
* Scope: local plus contract
* Could affect other tools: no direct evidence.
* Follow-up tests: Two runs with same `npm test` command keep separate validation rows.

## Reliability / Error-Handling Findings

### [HIGH] Refresh scheduler drops refresh errors

* Confidence: high
* Files: `frontend/src/tools/host/flowRefresh.ts`
* Functions / symbols: `createFlowRunsRefreshScheduler`
* Problem: Scheduled refresh does not catch rejected promises. A list-runs failure becomes an unhandled promise rejection and no user-visible Flow message is set.
* Evidence: Scheduler calls `void deps.refresh().then(() => deps.onRefreshed())` without `.catch` (`frontend/src/tools/host/flowRefresh.ts:56-59`). `refreshFlowRunsFromToolInvoke` throws on failed response (`frontend/src/tools/host/flowRefresh.ts:28-30`).
* Impact: IPC or backend failure during event refresh can leave stale UI with only console noise or unhandled errors.
* Fix: Add `onError` callback, set `flowMessage`, emit console entry, and keep scheduled flag cleanup deterministic.
* Scope: local
* Could affect other tools: yes, scheduler helpers should catch failures.
* Follow-up tests: Mock list-runs failure from scheduled refresh and assert visible error.

### [MEDIUM] `stop` returns success response even when no live run was stopped

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `frontend/src/tools/flow/actions.ts`
* Functions / symbols: `FlowService::stop`, `stopFlowRun`
* Problem: `FlowService::stop` always returns `Ok(FlowStopResponse { stopped })`, even when no cancel sender existed and it emitted `flow.run.error`. Frontend treats any `ok` invoke response as success and displays “Flow run stopped”.
* Evidence: Backend returns `Ok` regardless of `stopped` value (`src-tauri/src/app/flow_service.rs:266-270`). Frontend ignores the `stopped` boolean and sets `Flow run stopped` after any successful invoke response (`frontend/src/tools/flow/actions.ts:48-60`).
* Impact: The UI can show successful stop when backend reported no live run was cancelled.
* Fix: Return an error when no live run exists, or make frontend inspect `stopped` and display “run was already inactive/orphaned”. Align emitted event severity with response semantics.
* Scope: local
* Could affect other tools: yes, response `ok` versus nested success boolean ambiguity.
* Follow-up tests: Stop nonexistent/orphaned run must produce accurate UI message.

### [MEDIUM] Flow records do not include enough data to recover or audit phase execution

* Confidence: medium
* Files: `src-tauri/src/contracts.rs`, `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `FlowRunRecord`, `FlowStepStatus`
* Problem: Run records store step result/error strings but not command ids, stdout/stderr separation, nudge history, pause transitions, model selection, approval state, or side-effect file lists.
* Evidence: `FlowStepStatus` has only `step`, state, timestamps, result, error (`src-tauri/src/contracts.rs:1109-1118`). `FlowRunRecord` has settings and iterations, not side-effect/audit metadata (`src-tauri/src/contracts.rs:1131-1153`).
* Impact: After reload, the UI cannot reconstruct validation output, model fallback history, or which files/commands were used. Debugging failed or unsafe runs is difficult.
* Fix: Add structured per-step metadata with redaction rules: command id, exit code, duration, output summaries, model id, approval status, touched files, and emitted event ids.
* Scope: contract/backend
* Could affect other tools: yes, long-running tools need durable audit schema.
* Follow-up tests: Persist/reload a failed validation and assert details remain visible.

## Security / Policy-Boundary Findings

### [CRITICAL] User-provided commands run through `bash -lc` without approval, timeout, or sandboxing

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `frontend/src/tools/flow/index.tsx`
* Functions / symbols: `run_shell_command`, `implementCommand`, `backpressureCommands`
* Problem: Flow runs arbitrary command strings with `bash -lc`. There is no timeout, allowlist, user approval, workspace-root enforcement, or kill handle.
* Evidence: UI accepts Implement Command and Backpressure Commands as free text (`frontend/src/tools/flow/index.tsx:347-357`). Backend passes command string to `Command::new("bash").arg("-lc").arg(command).output()` (`src-tauri/src/app/flow_service.rs:1903-1909`).
* Impact: Flow can execute destructive or exfiltrating shell commands. A hung command can block the run indefinitely. On Windows, hard-coded `bash` may fail entirely.
* Fix: Route command execution through a terminal/command tool with policy, cwd, timeout, cancellation, and platform abstraction. Require explicit approval for non-dry-run command execution and show the exact command.
* Scope: architectural/security
* Could affect other tools: yes, any generated shell bridge.
* Follow-up tests: Reject unsafe mode, enforce timeout, kill command on stop, and support platform shell selection.

### [HIGH] Flow event payloads can leak secrets and sensitive output

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `frontend/src/tools/flow/index.tsx`, `docs/GUARDRAILS.md`
* Functions / symbols: `flow.step.progress`, `flow.run.nudge`, `llm_generate_text`
* Problem: Events include command stdout/stderr, nudge messages, and LLM HTTP error bodies. Guardrails require avoiding secrets in event payloads.
* Evidence: Guardrail says never include secrets in event payloads (`docs/GUARDRAILS.md:21-24`). Validation events include `stdout` and `stderr` (`src-tauri/src/app/flow_service.rs:820-837`). Nudge event includes `message` (`src-tauri/src/app/flow_service.rs:326-335`). LLM errors include up to 260 chars of response body (`src-tauri/src/app/flow_service.rs:1462-1471`). UI renders payload JSON in the event inspector (`frontend/src/tools/flow/index.tsx:241-250`).
* Impact: API errors, command output, or user nudges may expose tokens, credentials, filenames, or proprietary code in UI logs and copied event payloads.
* Fix: Add event redaction at `EventHub` or Flow emission points. Replace raw output with bounded summaries and secret scanning. Do not log nudge text by default; log length/hash.
* Scope: architectural/security
* Could affect other tools: yes, event redaction should be global.
* Follow-up tests: Secret-like strings in stdout/stderr/nudge/HTTP body are redacted in events.

### [HIGH] Auto-push can use ambient credentials without per-run confirmation

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `frontend/src/tools/flow/index.tsx`
* Functions / symbols: `autoPush`, `perform_native_git_push`
* Problem: If `autoPush` is enabled and dry-run is false, Flow pushes current branch to origin using SSH agent or `GIT_TOKEN`. There is no confirmation at the point of push.
* Evidence: Auto Push toggle is exposed in advanced controls (`frontend/src/tools/flow/index.tsx:328-331`). Push uses SSH agent or `GIT_TOKEN` (`src-tauri/src/app/flow_service.rs:2276-2289`) and pushes `refs/heads/{branch}` to origin (`src-tauri/src/app/flow_service.rs:2292-2297`).
* Impact: Flow can publish unintended commits or branches using ambient credentials.
* Fix: Require explicit push approval with remote/branch/commit summary. Default off is good, but backend policy must enforce an approval token, not just a frontend toggle.
* Scope: backend/security
* Could affect other tools: yes, any git/network publish action.
* Follow-up tests: Auto-push without approval token must fail before network call.

## Performance Findings

### [MEDIUM] Blocking HTTP and shell work inside Tokio tasks can starve runtime threads

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `tokio::spawn`, `llm_generate_text`, `run_shell_command`
* Problem: `run_loop` is spawned on Tokio, but it calls `reqwest::blocking`, `std::process::Command::output`, filesystem walks, and git operations synchronously.
* Evidence: `tokio::spawn` starts `run_loop` (`src-tauri/src/app/flow_service.rs:202-209`). LLM uses `reqwest::blocking::Client` (`src-tauri/src/app/flow_service.rs:1439-1461`). Shell uses blocking `Command::output` (`src-tauri/src/app/flow_service.rs:1903-1909`).
* Impact: Long Flow operations can consume runtime worker threads and delay other async IPC or event handling.
* Fix: Use async `reqwest::Client`, `tokio::process::Command`, `spawn_blocking` for git/libgit2 and filesystem-heavy work, and bounded concurrency.
* Scope: backend
* Could affect other tools: yes, any async task with blocking calls.
* Follow-up tests: Concurrent chat/terminal IPC remains responsive during long Flow validation.

### [MEDIUM] Flow can create terminal sessions for every phase automatically

* Confidence: high
* Files: `frontend/src/app/bootstrapFlowBridge.ts`
* Functions / symbols: `createFlowPhaseTerminalEventHandler`, `ensureFlowPhaseSession`
* Problem: Any Flow event for a known phase creates or reuses a terminal session and writes transcript text, even though it is not an actual process terminal for that phase.
* Evidence: Event handler calls `ensureFlowPhaseSession(phase)` for each flow event with a phase (`frontend/src/app/bootstrapFlowBridge.ts:78-112`). `ensureFlowPhaseSession` creates a new terminal session if none exists (`frontend/src/app/bootstrapFlowBridge.ts:61-75`).
* Impact: A run can create many pseudo-terminal sessions, increasing memory/PTY overhead and confusing users because the phase “terminal” is just event text.
* Fix: Replace phase terminals with a lightweight transcript panel by default. Create real terminal sessions only on explicit user request or when a command actually runs in an attached PTY.
* Scope: frontend/UX/performance
* Could affect other tools: yes, fake terminal reuse is a pattern to avoid.
* Follow-up tests: Flow event stream does not allocate PTY sessions unless requested.

### [LOW] Spec collection walks recursively with simplistic glob matching and no limits

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`
* Functions / symbols: `collect_spec_files`, `walk_recursive`, `split_glob`
* Problem: `specsGlob` is not a real glob and recursive walking has no file count/depth/ignore limits.
* Evidence: `split_glob` only splits on the first `*` (`src-tauri/src/app/flow_service.rs:1814-1821`). `walk_recursive` traverses all nested entries and pushes every directory (`src-tauri/src/app/flow_service.rs:1823-1840`).
* Impact: A broad glob can scan large trees, including build outputs, causing slow starts.
* Fix: Use a real glob crate with workspace-root checks, `.gitignore` support if appropriate, and limits on count/depth/bytes.
* Scope: backend
* Could affect other tools: yes, file scanning should be centralized.
* Follow-up tests: Large tree and malformed glob tests.

## Test Coverage Gaps

### [HIGH] Existing tests do not cover Flow end-to-end behavior

* Confidence: high
* Files: `src-tauri/src/app/flow_service.rs`, `src-tauri/src/tools/invoke/registry.rs`, `frontend/tests/*`, `src-tauri/tests/*`
* Functions / symbols: `tests` modules, `frontend/tests`
* Problem: Rust tests cover a few helpers (`mark_task_complete`, task selection, shell nonzero, implement command required) and registry basics. There are no frontend Flow tests, no IPC Flow handler tests, no create-project tests, no cancellation tests, and no state-reconciliation tests.
* Evidence: `src-tauri/src/app/flow_service.rs:2332-2417` has four helper tests. `src-tauri/src/tools/invoke/registry.rs:45-96` tests registry mechanics. `frontend/tests` only contain TTS and send-message tests by filename/search. `cargo test --quiet` passed 8 non-ignored tests and 4 ignored integration tests.
* Impact: The riskiest behavior is untested, which explains why serious architectural and state bugs can survive.
* Fix: Add tests for every high-risk behavior listed below, using mocked services where needed.
* Scope: test infrastructure
* Could affect other tools: yes, generic invoke/tool host also lacks invariant coverage.
* Follow-up tests:
  - `flow.start` rejects sandbox side effects.
  - create-project writes expected files through backend action.
  - stop kills long command and final status remains stopped.
  - restart recovery handles persisted running runs.
  - disabled Flow cannot be invoked.
  - frontend malformed response handling.
  - event copy selects correct payload.
  - validation results scoped by run/iteration.

## Prioritized Remediation Plan

1. Freeze non-dry-run Flow in production until mode, cancellation, and git safety are fixed.
2. Enforce workspace-tool enablement and `ToolMode` in `cmd_tool_invoke`.
3. Move Flow side effects behind policy-aware tools/services.
4. Replace blocking shell/HTTP/git execution with cancellable, bounded execution.
5. Implement startup recovery for persisted active runs.
6. Move Create Project into backend typed Flow action with transactional semantics.
7. Decide and implement the real Ralph Loop/agent integration contract.
8. Add durable per-run state for pause, nudges, validation, model fallback, commands, and touched files.
9. Rework frontend state to derive active run/pause/validation from backend snapshots.
10. Add high-risk tests before extending features.

## Concrete Fix Recommendations For Every Issue

The specific fix for each issue is listed in its finding. Cross-cutting implementation recommendations:

- Make `ToolInvokeHandler` accept the full `ToolInvokeRequest`, not only `payload`.
- Add a capability table: `flow.start.dry`, `flow.start.build`, `flow.git.commit`, `flow.git.push`, `flow.command.run`, `flow.create_project`.
- Store `workspaceRoot`, `mode`, approval tokens, and side-effect permissions in each `FlowRunRecord`.
- Replace `FlowService::execute_step` direct side effects with typed action calls.
- Add a `RunExecutor` abstraction with cancellation tokens, child-process handles, and terminal/event streaming.
- Add a `FlowProjectService` for Create Project, returning `{ artifacts, pluginToolId?, warnings }`.
- Add event redaction before `EventHub::emit`.
- Mark old running records interrupted on startup unless a durable executor exists.

## Files Reviewed

- `docs/ARCHITECTURE.md`
- `docs/TOOLS_ARCHITECTURE.md`
- `docs/GUARDRAILS.md`
- `docs/IPC_EVENTS.md`
- `frontend/src/tools/flow/actions.ts`
- `frontend/src/tools/flow/bindings.ts`
- `frontend/src/tools/flow/index.tsx`
- `frontend/src/tools/flow/manifest.ts`
- `frontend/src/tools/flow/runtime.ts`
- `frontend/src/tools/flow/state.ts`
- `frontend/src/tools/flow/styles.css`
- `frontend/src/tools/registry.ts`
- `frontend/src/tools/workspaceViewRegistry.ts`
- `frontend/src/tools/host/flowEvents.ts`
- `frontend/src/tools/host/flowRefresh.ts`
- `frontend/src/tools/host/viewBuilder.ts`
- `frontend/src/tools/host/workspaceDispatch.ts`
- `frontend/src/tools/host/workspaceLifecycle.ts`
- `frontend/src/tools/host/workspaceRuntime.ts`
- `frontend/src/tools/files/actions.ts`
- `frontend/src/tools/files/index.tsx`
- `frontend/src/tools/webSearch/actions.ts`
- `frontend/src/tools/chart/*`
- `frontend/src/app/bootstrapFlowBridge.ts`
- `frontend/src/app/events.ts`
- `frontend/src/app/persistence.ts`
- `frontend/src/app/workspaceInteractions.ts`
- `frontend/src/main.ts`
- `frontend/src/contracts.ts`
- `frontend/src/ipcClient.ts`
- `frontend/tests/*`
- `src-tauri/src/app/mod.rs`
- `src-tauri/src/app/chat_service.rs`
- `src-tauri/src/app/files_service.rs`
- `src-tauri/src/app/flow_service.rs`
- `src-tauri/src/contracts.rs`
- `src-tauri/src/ipc/flow.rs`
- `src-tauri/src/ipc/tool_runtime.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/tools/invoke/flow.rs`
- `src-tauri/src/tools/invoke/files.rs`
- `src-tauri/src/tools/invoke/mod.rs`
- `src-tauri/src/tools/invoke/registry.rs`
- `src-tauri/src/tools/registry.rs`
- `src-tauri/src/tools/tool.rs`
- `src-tauri/src/workspace_tools/mod.rs`
- `src-tauri/src/agent_tools/mod.rs`
- `src-tauri/tests/*`

## Open Questions / Uncertainties

- Whether “Ralph Loop” is intended to mean the existing chat agent loop, a separate future engine, or this fixed Flow phase loop. The code does not make the intended contract explicit.
- Whether Flow should operate on the same root as FilesService in production Tauri bundles. The current code suggests yes, but uses different root-resolution mechanisms.
- Whether native git commit/push was intended to be enabled by default. The env var name suggests a feature gate, but the implementation defaults to enabled.
- Whether phase “terminal” panels are intended to be real terminals or event transcripts. Current code creates terminal sessions but writes event text, which is semantically mixed.
- Whether generated app-tool plugins are meant to be immediately usable or only placeholders. Current manager status marks them ready.

## Suggested Follow-Up Validation Steps After Fixes

1. Add a black-box Playwright or DOM test for Create Project modal: create project, verify artifacts, verify run starts or copy says it does not.
2. Add Rust integration tests for `cmd_tool_invoke` policy: disabled tool, sandbox mode, non-dry-run, git push approval.
3. Add cancellation tests with a long-running command and a fake long-running LLM request.
4. Add restart-recovery tests using a temp persisted `flow-runs.json`.
5. Add workspace-root tests from both repo root and `src-tauri` cwd.
6. Add event redaction tests for stdout/stderr/nudge/API error payloads.
7. Add UI state tests for selecting runs, pause labels, validation rows, and event-copy behavior.
8. Manually test a real dry-run plan flow, a rejected build flow, a cancelled build flow, and an approved build flow in a disposable git repo.

## Top 20 Most Urgent Fixes

1. Enforce `ToolMode`; reject side effects under `sandbox`.
2. Gate `toolInvoke` by workspace-tool enablement.
3. Disable native git by default.
4. Prevent Flow from staging all files.
5. Add cancellable command execution and kill on stop.
6. Add cancellable async LLM requests.
7. Guard `finish_run` against overwriting stopped runs.
8. Mark persisted active runs interrupted on startup.
9. Move Create Project side effects to backend Flow action.
10. Unify Flow path resolution with FilesService root and containment checks.
11. Replace direct service side effects with registry/tool calls.
12. Define real Ralph Loop/agent integration.
13. Persist per-run pause/nudge/validation/model metadata.
14. Redact event payloads.
15. Fix frontend event copy indexing.
16. Scope validation results by run and iteration.
17. Catch scheduled refresh errors and surface them.
18. Validate frontend invoke responses at runtime.
19. Stop auto-creating terminal sessions for phase transcripts.
20. Add end-to-end Flow tests before adding features.

## Suggested Order Of Implementation

1. Safety gates first: mode enforcement, enablement gating, native git default off, event redaction.
2. Cancellation and run-state correctness: cancellable command/LLM execution, guarded finalization, restart recovery.
3. Architecture cleanup: backend create-project action, registry/tool side-effect routing, workspace root unification.
4. Frontend state cleanup: per-run pause/validation, event copy, refresh error handling, accurate labels.
5. Real capability work: define and implement Ralph Loop/agent integration.
6. Test expansion: add the test gaps listed above and keep them blocking for future Flow changes.

## Potential Systemic Root Causes

- AI-generated code appears to have matched file names and UI patterns without preserving the architecture contract.
- The repo has two registry concepts, making it easy to claim “generic invoke” while bypassing the documented tool trait/policy gateway.
- The frontend main file still owns too much cross-tool orchestration, encouraging hidden coupling.
- Tests validate helpers and happy paths rather than policy, cancellation, persistence, and cross-layer contracts.
- UI affordances were added before backend semantics were made durable.

## Places Where Other AI-Generated Tools May Have The Same Flaw Pattern

- Any tool using `toolInvoke` without enablement or `ToolMode` enforcement.
- Any frontend modal that calls files/plugin APIs directly instead of a typed backend service.
- Any service that directly calls `std::fs`, `Command::new`, network clients, or git libraries instead of a registry-controlled tool.
- Any workspace tool that embeds another tool’s rendered HTML and shares state implicitly.
- Any event inspector that displays raw payloads without redaction.
- Any async action that sets busy state but relies on a rerender only after the awaited operation completes.
