# Looper Comprehensive Review

Date: 2026-04-16

## Scope Reviewed

- App docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/TOOLS_ARCHITECTURE.md`, `docs/IPC_EVENTS.md`, `docs/TAURI_INTEGRATION.md`
- Existing Looper notes: `temp/looper-plan.md`, `temp/looper-status.md`, `temp/LOOPER_CONTEXT.md`
- Frontend Looper files:
  - `frontend/src/tools/looper/manifest.ts`
  - `frontend/src/tools/looper/state.ts`
  - `frontend/src/tools/looper/runtime.ts`
  - `frontend/src/tools/looper/actions.ts`
  - `frontend/src/tools/looper/bindings.ts`
  - `frontend/src/tools/looper/index.tsx`
  - `frontend/src/tools/looper/styles.css`
  - host integration files under `frontend/src/tools/host/`
  - Looper wiring in `frontend/src/main.ts`
- Tauri/Rust Looper files:
  - `src-tauri/src/tools/looper_handler.rs`
  - `src-tauri/src/tools/invoke/looper.rs`
  - `src-tauri/src/ipc/looper.rs`
  - app/tool registration and IPC bridge files

## Executive Summary

Looper is not currently a working long-duration autonomous loop in the way a user would expect.

The current shipped path is still effectively frontend-only. It can create four terminal sessions and send the planner prompt, but it does not actually orchestrate the loop end-to-end. Most of the configuration UI is either ignored or only partially applied. Pause/stop are largely cosmetic. Refresh loses state. The dormant backend Looper code is not wired into the app, and if it were wired today it would still fail immediately because of compile and lifecycle issues.

The biggest problems are:

1. The user-facing flow does not execute beyond the planner terminal.
2. The empty-state configuration and install UX are misleading and partly invisible.
3. The backend Looper implementation is dead code and not integrated into the app architecture described in the docs.
4. The frontend runtime and backend event payloads do not agree.
5. Existing Looper tests were stale and not actually running.

## Verification Performed

- `cargo check --features tauri-runtime` in `src-tauri/`: passed
- `npm test` in `frontend/`: passed after replacing stale Looper tests
- `npm run check` in `frontend/`: still fails, but only on pre-existing non-Looper TypeScript errors in `main.ts`, `files`, and `notepad`

Important note: the Rust check passing does not mean backend Looper is healthy. It passes because the Looper Rust modules are not actually connected into the compiled module tree.

## What A User Expects vs What Actually Happens

## Step 1: Open the Looper tab

Expected:

- Looper initializes itself.
- If OpenCode is missing, the user gets a clear blocking install flow.
- If prior loops exist, the tool restores or reloads them.

Actual:

- `workspaceLifecycle.ts:61-65` only calls `ensureLooperInit(...)` once.
- `frontend/src/tools/looper/actions.ts:71-77` only checks whether OpenCode is installed.
- There is no backend `list`/restore call from the frontend.
- Loop state lives only in frontend memory in `state.ts:31-57, 181-208`.

Problems:

- Refreshing the app loses all loop state.
- Reopening the tab does not reload loops from any backend source.
- The init path checks install status, but it does not sync runtime state.

## Step 2: Land on the empty-state splash screen

Expected:

- The user can fully configure the first loop before creating it.
- Install/config modals should work even before the first loop exists.

Actual:

- The splash UI renders in `frontend/src/tools/looper/index.tsx:90-161`.
- The toolbar always includes `Configure` in `renderLooperToolActions()` at `index.tsx:51-84`.
- The config modal and install modal are only appended in the non-empty-loop branch at `index.tsx:171-176`.

Problems:

- Clicking `Configure` before creating the first loop sets state, but no modal is rendered because the empty-state branch never includes `renderConfigModal(state)`.
- If OpenCode is missing, `installModalOpen` can become `true`, but no install modal is rendered on the splash screen.
- The first-run UX therefore hides the two most important blocking surfaces.

## Step 3: Fill out the splash form

Expected:

- Project metadata, working directory, task path, specs glob, max iterations, and model selections should all affect the first loop.

Actual:

- Project metadata fields update drafts in `bindings.ts:156-170`.
- Advanced fields update `config*Draft` values in `bindings.ts:191-208`.
- Model selectors update `state.phaseModels` in `bindings.ts:172-190`.
- `createLoop()` in `actions.ts:79-121` uses `state.cwd`, not `state.configCwdDraft`.
- `taskPath`, `specsGlob`, `maxIterations`, and `phaseModels` are not consumed anywhere in the frontend execution path.

Problems:

- The splash screen suggests the first loop will use the advanced settings, but the working directory draft is ignored unless it has already been applied into `state.cwd` through the modal.
- The task file and specs glob drafts are also ignored during actual execution.
- Max iterations is never enforced by the frontend loop implementation.
- Model selection is UI-only in the active frontend path.
- Practically, on first use, only the project metadata changes the planner prompt text.

## Step 4: Click `New Loop`

Expected:

- A configured loop object is created with the selected working directory and execution settings.
- The loop is ready to be orchestrated end-to-end.

Actual:

- `createLoop()` creates four terminal sessions directly from the frontend in `actions.ts:97-105`.
- It does not check `state.installed` before creating them.
- It does not use backend IPC at all.

Problems:

- The user can create loops even when OpenCode is not installed.
- The loop is frontend-owned, which violates the app architecture in `docs/ARCHITECTURE.md` and `docs/TOOLS_ARCHITECTURE.md` for orchestration logic.
- Sessions are created up front, but there is no reliable execution state machine behind them.

## Step 5: Click `Start Loop`

Expected:

- Planner starts.
- Planner completion advances to executor.
- Executor advances to validator.
- Validator gates critic.
- Critic returns SHIP/REVISE and either completes or starts another iteration.

Actual:

- `startLoop()` in `actions.ts:123-160` sets the planner to running and sends:
  - `opencode\n`
  - then the planner prompt after a fixed sleep
- `advancePhase()` exists in `actions.ts:162-206`, but nothing calls it.
- There is no frontend event handler wired into the core app event pipeline for Looper.

Problems:

- The loop does not auto-advance beyond the planner.
- Fixed sleeps (`300ms`, `1500ms`) are brittle and can race OpenCode startup.
- Task/specs/maxIterations/model settings still do nothing.
- The user sees a tool labeled as a multi-phase autonomous loop, but only phase one is actually started.

## Step 6: Watch execution progress

Expected:

- Phase transitions update the timeline.
- Terminal output and exits drive the runtime.
- Backend events keep the UI in sync.

Actual:

- `frontend/src/tools/looper/runtime.ts` exists and can process `looper.*` events.
- `frontend/src/tools/host/looperEvents.ts` exists.
- `frontend/src/tools/host/looperTerminalBridge.ts` exists.
- None of them are wired into `frontend/src/main.ts` or `frontend/src/app/events.ts`.
- `handleCoreAppEvent()` only invokes Flow runtime hooks at `frontend/src/app/events.ts:79-81, 215-217`.

Problems:

- Even if backend Looper events were emitted, the current frontend would ignore them.
- The frontend Looper runtime is effectively dead code.
- The current host event pipeline supports Flow, not Looper.

## Step 7: Pause, resume, stop

Expected:

- Pause should actually pause orchestration.
- Resume should exist.
- Stop should stop running terminals and mark the loop ended.

Actual:

- `pauseLoop()` in `actions.ts:208-213` only sets `loop.status = "paused"`.
- `stopLoop()` in `actions.ts:215-221` only sets `loop.status = "failed"` and a timestamp.
- There is no frontend resume action in `renderLooperToolActions()`.

Problems:

- Pause is cosmetic; it does not pause terminal sessions.
- There is no resume control after pause.
- Stop does not terminate the phase terminals.
- The toolbar behavior after pause strands the loop in a state the user cannot continue from.

## Step 8: Close the loop or refresh the app

Expected:

- Close should cleanly tear down resources.
- Refresh should preserve meaningful state or restore from backend.

Actual:

- `closeLoop()` in `actions.ts:223-244` does close phase sessions and remove the loop locally.
- Refresh recreates `getInitialLooperState()` with no persistence.

Problems:

- Close works better than pause/stop, but only in the local frontend model.
- Refresh loses all active loops and all history.

## Critical Findings

### 1. Backend Looper is not wired into the app at all

Evidence:

- `src-tauri/src/tools/mod.rs:1-5` does not include `looper_handler`.
- `src-tauri/src/tools/invoke/mod.rs:3-16` does not register `looper`.
- `src-tauri/src/ipc/mod.rs:1-46` does not include Looper IPC.
- `src-tauri/src/ipc/tauri_bridge.rs:19-32` has no `looper_handler` on `TauriBridgeState`.
- `src-tauri/src/app/mod.rs:18-103` creates chat/terminal/flow context, but no Looper service/handler wiring.

Impact:

- All Rust Looper files are effectively dead code.
- The frontend cannot call Looper backend actions because the invoke registry does not expose them.

### 2. The frontend execution path is still frontend-only orchestration

Evidence:

- `frontend/src/tools/looper/actions.ts:79-206` creates sessions and sends terminal input directly.
- No `client.toolInvoke({ toolId: "looper", ... })` calls exist in the active Looper actions.

Impact:

- Looper violates the app's architecture contract.
- Business logic and orchestration live in the UI layer.
- The tool cannot be made reliable without backend ownership.

### 3. Empty-state config/install UX is broken

Evidence:

- Empty-state splash branch: `frontend/src/tools/looper/index.tsx:90-161`
- Modal rendering only after loops exist: `frontend/src/tools/looper/index.tsx:171-176`

Impact:

- The user cannot see the config modal before first loop creation.
- The user cannot see the install modal before first loop creation.
- This blocks correct first-time setup.

### 4. Splash advanced settings are misleading and mostly ignored

Evidence:

- Splash advanced inputs write only draft fields: `bindings.ts:191-208`
- `createLoop()` reads `state.cwd`, not `configCwdDraft`: `actions.ts:87-100`
- `taskPath`, `specsGlob`, `maxIterations`, `phaseModels` are not used by `startLoop()` or `advancePhase()`.

Impact:

- The user believes the first loop is configured, but the first loop runs with defaults.
- This is one of the highest expectation mismatches in the current UI.

### 5. There is no actual multi-phase execution loop

Evidence:

- `startLoop()` only launches planner: `actions.ts:123-160`
- `advancePhase()` is never invoked from the runtime or event pipeline

Impact:

- The primary advertised value of Looper is missing.

### 6. Pause/stop/resume behavior is not functionally correct

Evidence:

- Pause/stop mutate local state only: `actions.ts:208-221`
- Toolbar has no resume path after pause: `index.tsx:22-88`

Impact:

- Users cannot trust controls to affect running work.

## High-Risk Latent Bugs In The Dormant Rust Implementation

These are not currently user-visible because the Rust Looper is not wired in, but they must be fixed before any backend activation.

### 1. `start()` stores the loop after creating sessions, so session IDs are never attached

Evidence:

- `looper_handler.rs:470-476` calls `create_phase_sessions(&loopy)` before inserting `loopy` into `self.loops`
- `create_phase_sessions()` tries to mutate `self.loops` at `looper_handler.rs:779-785`

Impact:

- If this backend path were activated, `start_phase()` would fail because `session_id` was never recorded.

### 2. Frontend/runtime and backend event payloads do not match

Evidence:

- Frontend runtime expects `payload.phase` for transition events at `frontend/src/tools/looper/runtime.ts:50-69, 226-250`
- Backend emits `fromPhase` and `toPhase` at `src-tauri/src/tools/looper_handler.rs:944-956`

Impact:

- Even after wiring, the UI would not process transition events correctly.

### 3. Looper contracts are missing from shared contract files

Evidence:

- Rust Looper files import many `Looper*` contract types at `src-tauri/src/tools/looper_handler.rs:29-38` and `src-tauri/src/tools/invoke/looper.rs:12-18`
- Current shared contract files do not define a frontend or Rust Looper contract surface

Impact:

- Proper backend activation will require adding shared request/response types first.

### 4. `TerminalOpenSessionRequest` currently has no `model` field, but Looper backend tries to use one

Evidence:

- Terminal request shape in `src-tauri/src/contracts.rs:123-129`
- Looper backend tries to set `model` at `src-tauri/src/tools/looper_handler.rs:770-777`

Impact:

- This is another backend compile/integration blocker.

### 5. Backend pause semantics still would not actually pause the running process

Evidence:

- `looper_handler.rs:552-589` only flips loop status

Impact:

- The backend path would still need real process/session control semantics.

### 6. Auto-commit is currently placed before validation, not after successful validation

Evidence:

- `looper_handler.rs:982-996` auto-commits when executor exits, before validator runs

Impact:

- This can commit broken code and violates the expected back-pressure model.

### 7. Terminal exit events do not include exit codes

Evidence:

- Terminal exit payload is only `{ sessionId }` in `src-tauri/src/app/terminal_service.rs:109-116`

Impact:

- Looper cannot reliably distinguish success from failure on phase exit.

## Additional Frontend Issues

### 1. `ensureLooperInit()` only checks install status

Evidence:

- `frontend/src/tools/looper/actions.ts:71-77`

Impact:

- It should also refresh backend Looper state once backend ownership exists.

### 2. `getActiveLoopId()` reads from the DOM instead of from state

Evidence:

- `frontend/src/tools/looper/bindings.ts:214-217`

Impact:

- This is brittle and can drift from state during rerenders or partial DOM updates.

### 3. Looper CSS uses undefined theme tokens and hardcoded colors

Evidence:

- `frontend/src/tools/looper/styles.css` uses `--text-muted`, `--text`, `--border`, `--text-on-accent`, plus hardcoded greens/reds

Impact:

- Visual behavior can differ from the design system and may silently fall back to invalid values.

### 4. Looper terminal bridge would duplicate generic terminal writes if wired as-is

Evidence:

- Generic terminal output handling already writes output in `frontend/src/app/events.ts:110-125`
- `frontend/src/tools/host/looperTerminalBridge.ts:19-54` also writes output and marks exits for Looper sessions

Impact:

- If wired without redesign, output/exit handling would likely double-apply.

## What Needs To Be Fixed

## Priority 1: Pick one architecture and finish it

Recommended choice:

- Use backend-owned orchestration, matching `docs/ARCHITECTURE.md` and `docs/TOOLS_ARCHITECTURE.md`.

Why:

- Long-duration, autonomous, multi-phase loops are state machines with process ownership and persistence concerns.
- Those should not live in the frontend.

## Priority 2: Wire Rust Looper into the real app

Required changes:

- Add `pub mod looper_handler;` under `src-tauri/src/tools/mod.rs`
- Register Looper in `src-tauri/src/tools/invoke/mod.rs`
- Add Looper IPC module to `src-tauri/src/ipc/mod.rs`
- Extend `TauriBridgeState` to hold the Looper command/service handle
- Construct the Looper service in `src-tauri/src/app/mod.rs`
- Start the Looper terminal-exit listener from app setup

## Priority 3: Add shared Looper contracts

Required changes:

- Add Looper request/response types to `src-tauri/src/contracts.rs`
- Add matching frontend types to `frontend/src/contracts.ts`
- Keep event payload names exactly aligned

Minimum contract surface:

- `start`
- `stop`
- `pause` / `resume`
- `status`
- `list`
- `close`
- `check-opencode`
- any question/answer submission contract if PRD mode remains supported

## Priority 4: Convert frontend Looper actions to IPC-backed actions

Required changes:

- `ensureLooperInit()` should call backend `check-opencode` and `list`
- `create/start/pause/stop/close` should use `client.toolInvoke(...)`
- Frontend should stop directly creating/managing Looper phase sessions

## Priority 5: Fix the first-run UX

Required changes:

- Always render config/install modals, even with zero loops
- Either:
  - make splash advanced fields update live config directly, or
  - make `New Loop` build its request from draft values
- Block `New Loop` and `Start Loop` when OpenCode is not installed
- Add an explicit `Resume` action when paused

## Priority 6: Make the event pipeline real

Required changes:

- Import and wire `applyLooperRuntimeEvent(...)` into `main.ts`
- Add Looper handling into the core app event path alongside Flow
- Do not wire `looperTerminalBridge.ts` in its current form without redesigning for non-duplicated terminal handling
- Align transition payload names between backend and frontend

## Priority 7: Fix dormant backend bugs before activation

Required changes:

- Insert/store the loop before mutating it in `create_phase_sessions()`, or return created sessions and attach them before insert
- Add exit code to terminal exit events
- Move auto-commit to after successful validation, or remove it until explicitly designed
- Make pause/stop actually control the underlying session/process lifecycle

## Recommended Test Plan

## Tests Added In This Review

Added `frontend/tests/looperTool.test.ts` and removed the stale Jest-era Looper tests under `frontend/src/tools/looper/tests/`.

Current automated Looper tests now cover:

- planner prompt project-context injection
- initial Looper state defaults
- supported runtime event handling for `looper.loop.start` and `looper.phase.start`
- a characterization test showing the current `toPhase` payload mismatch is ignored by the frontend runtime

## Tests Still Needed Before Calling Looper Reliable

Frontend integration tests:

- Opening Looper with zero loops still renders config/install modals
- Splash advanced values are used for the first created loop
- Start is blocked when OpenCode is missing
- Pause shows Resume and Resume actually resumes
- Stop actually stops execution and closes sessions

Backend tests:

- `start` creates sessions, stores them, and launches planner successfully
- planner terminal exit advances to executor
- validator failure prevents SHIP
- critic `REVISE` starts a new iteration until `maxIterations`
- critic `SHIP` completes the loop
- persistence roundtrip restores list/status correctly
- app-tool project scaffold path becomes the loop cwd

Cross-layer tests:

- backend `looper.phase.transition` payload matches frontend runtime parser
- `check-opencode` result reaches the UI and blocks invalid starts
- `list` on tab activation restores frontend state from backend records

## Bottom Line

Looper should not be treated as a mostly-finished tool with a few bugs. It is currently a partial prototype with a convincing UI shell.

The frontend-visible path can start a planner terminal, but it does not deliver the autonomous multi-phase loop the user is promised. The backend path is closer to the right architecture, but it is not wired in and still contains critical activation bugs. The right fix is not incremental patching of the current frontend-only path; it is finishing the backend-owned Looper design and then reconnecting the frontend as a thin state/view layer.

## Follow-Up Implemented

The following fixes were implemented after this review was written:

- Added shared Looper request/response contracts to `src-tauri/src/contracts.rs` and `frontend/src/contracts.ts`
- Wired Looper into:
  - `src-tauri/src/tools/mod.rs`
  - `src-tauri/src/tools/invoke/mod.rs`
  - `src-tauri/src/ipc/mod.rs`
  - `src-tauri/src/ipc/tauri_bridge.rs`
  - `src-tauri/src/app/mod.rs`
  - `src-tauri/src/main.rs`
- Enabled workspace-tool gating for `looper` in `src-tauri/src/ipc/tool_runtime.rs`
- Fixed Rust Looper startup so phase sessions are created after the loop record exists in handler state
- Added `looper.phase.complete` emission and aligned transition payloads so the frontend accepts backend `toPhase` transitions
- Added frontend support for normalizing backend Looper records and refreshing Looper state via tool invoke
- Converted OpenCode install checking from frontend shell probing to backend `check-opencode` invoke
- Switched pause/stop/close to backend invoke actions
- Wired Looper runtime events into the frontend app event pipeline
- Added frontend terminal-manager support for registering backend-created sessions so Looper sessions can mount and receive output
- Fixed empty-state rendering so the Looper config/install modals render before the first loop exists
- Added a resume action for paused loops
- Replaced the stale non-running Looper tests with a Node-based Looper runtime test file at `frontend/tests/looperTool.test.ts`

Remaining limitations after the implementation pass:

- Frontend `tsc --noEmit` still fails due pre-existing non-Looper TypeScript errors elsewhere in the app
- Looper prompt/config snapshots are only preserved for local pre-start loop placeholders; backend list responses do not yet roundtrip every launch setting
- Looper-specific integration coverage is still lighter than it should be for a tool of this complexity

## Follow-Up Implemented (Second Pass)

Additional fixes completed after the first implementation pass:

- Added richer persisted Looper records so backend loop snapshots now preserve:
  - `cwd`
  - `taskPath`
  - `specsGlob`
  - `maxIterations`
  - phase model selections
  - project metadata
- Added disk-backed Looper persistence wiring:
  - Looper state file now lives under the workspace tool state root as `looper-state.json`
  - backend Looper state is loaded on app startup
  - loop state is saved after start, stop, pause/resume, close, and iteration transitions
- Upgraded backend pause/resume behavior:
  - pause now closes the active phase terminal session and marks the loop paused/blocked
  - resume recreates the active phase session and restarts that phase
  - this is a meaningful operational pause/resume, not only a UI flag flip
- Added Rust unit tests in `src-tauri/src/tools/looper_handler.rs` covering:
  - Looper record persistence of launch fields
  - restoration of running loops as paused/blocking loops without stale live session ids

Current verification status after the second pass:

- `cargo test --features tauri-runtime` ✅
- `cargo check --features tauri-runtime` ✅
- `npm test` ✅
- `npm run check` still fails only on pre-existing non-Looper frontend TypeScript errors

## Follow-Up Implemented (Third Pass)

Additional execution-semantics fixes completed after the second pass:

- Removed premature auto-commit behavior from the executor->validator transition path
- Moved Looper auto-commit to the final `SHIP` path only, after critic completion
- Fixed stale-session reuse across iterations:
  - when a phase terminal exits, Looper now clears that phase's stored `sessionId`
  - the backend terminal session is closed and removed from the terminal service map
  - `start_phase(...)` now recreates a phase session lazily if no live session exists
- Fixed revise-loop restart behavior:
  - a `REVISE` decision now resets loop state for a clean next iteration
  - all phase statuses reset to idle
  - all phase session ids are cleared so the next iteration cannot reuse exited sessions
  - `activePhase` is set back to `planner`

Additional Rust test coverage added:

- `apply_critic_decision_ship_completes_loop`
- `apply_critic_decision_revise_starts_clean_next_iteration_state`
- `apply_critic_decision_fails_when_revision_exceeds_max_iterations`

Current verification status after the third pass:

- `cargo test --features tauri-runtime` ✅
- `cargo check --features tauri-runtime` ✅
- `npm test` ✅
- frontend `npm run check` remains blocked only by pre-existing non-Looper TypeScript issues elsewhere in the app
