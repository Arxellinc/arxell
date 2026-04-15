# Looper Tool Status Report

## Overview

The **Looper** tool is a multi-agent orchestration surface with four phases: Planner, Executor, Validator, and Critic. It is designed to run iterative loop cycles using the OpenCode CLI.

---

## Functional Components

### Frontend (Fully Implemented)

| File | Status | Notes |
|------|--------|-------|
| `manifest.ts` | ✅ Complete | Tool manifest with id, version, title, description, category |
| `state.ts` | ✅ Complete | Full state types: `LooperPhase`, `LooperLoopRun`, `LooperToolState`, substep definitions, default prompts |
| `actions.ts` | ✅ Complete | Core functions: `ensureLooperInit`, `createLoop`, `startLoop`, `advancePhase`, `pauseLoop`, `stopLoop`, `closeLoop` |
| `bindings.ts` | ✅ Complete | Click and input handlers for all looper actions |
| `index.tsx` | ✅ Complete | Render functions for toolbar, body, timeline, terminal grid, config modal, install modal |
| `styles.css` | ✅ Complete | Full styling for looper workspace, timeline, terminal panels, modals |

### Backend Registration

| Component | Status | Location |
|-----------|--------|----------|
| Workspace tool manifest | ✅ Registered | `src-tauri/src/workspace_tools/mod.rs:95-102` |
| Frontend registry | ✅ Included | `frontend/src/tools/registry.ts:45` (in `PREFERRED_TOOL_ORDER`) |
| View builder | ✅ Integrated | `frontend/src/tools/host/viewBuilder.ts:400-403` |
| Workspace lifecycle | ✅ Integrated | `frontend/src/tools/host/workspaceLifecycle.ts:55-60` |

---

## Non-Functional / Missing Components

### 1. Backend Invoke Handler — **NOT IMPLEMENTED**

There is no `src-tauri/src/tools/invoke/looper.rs`. The looper tool has **no backend invoke actions**. All looper logic runs on the frontend only.

### 2. Backend Agent Tool — **NOT IMPLEMENTED**

There is no `src-tauri/src/agent_tools/looper.rs`. The looper is **not exposed to the agent runtime**.

### 3. Terminal Session Management — **PARTIAL/UNINTEGRATED**

The looper creates terminal sessions for each phase (`createSession` in `createLoop`) and sends commands (`sendTerminalInput` in `startLoop`), but:

- **No backend terminal session ownership** — Sessions are created via frontend's `TerminalManager`, not a dedicated looper backend service
- **No phase advancement** — `advancePhase()` exists in `actions.ts` but is **never called** anywhere
- **No output handling** — Terminal output events are not wired to trigger phase transitions
- **Loop execution is fire-and-forget** — `startLoop` sends opencode + prompt to the planner terminal, but the loop never automatically advances through executor → validator → critic phases

### 4. OpenCode CLI Detection — **PARTIAL**

`checkOpenCodeInstalled()` in `actions.ts` attempts to detect the OpenCode CLI via a terminal `which opencode` command. This works only if:

- The Terminal tab is accessible
- The shell can execute `which`
- The output parsing succeeds

There is **no dedicated backend command** for opencode availability checking.

### 5. Model Selection — **UI ONLY**

The splash form and config modal allow selecting models per phase (or "auto" for all). However:

- `state.phaseModels` is populated from UI interactions
- The selected models are **never used** in `startLoop` or any other action
- No backend call passes the model selection to the agent runtime

### 6. Persistence — **NOT IMPLEMENTED**

Loop state (`loops`, `activeLoopId`, etc.) is held in React state only. On page refresh:

- All loops are lost
- `looperNeedsInit` resets to `true`
- `ensureLooperInit` runs again

There is no persistence to `localStorage` or a backend session store.

### 7. Config Modal vs Splash Form Redundancy

The looper has **two** configuration flows:

1. **Splash form** — Shown when `loops.length === 0`; captures project name, type, icon, description, model selection, and advanced options (cwd, max iterations, task path, specs glob)
2. **Config modal** — Opened via toolbar "Configure" button; captures cwd, task path, specs glob, max iterations

These overlap but are **not synchronized**. The splash form writes to `configCwdDraft`, `configTaskPathDraft`, etc., but the config modal reads/writes the same draft fields. Additionally, the **applied config** (from the modal's "Apply") writes to `cwd`, `taskPath`, `specsGlob`, `maxIterations` — which are **never read back** into the splash form draft fields after "Apply".

---

## What Works (Testable Today)

1. **Switching to the Looper tab** — The tab appears in the workspace toolbar and switches to the looper view
2. **Splash form UI** — All inputs render and accept values (project name, type, description, model selection, advanced options)
3. **New Loop creation** — Clicking "New Loop" creates terminal sessions for all 4 phases (visible in the Terminal tab)
4. **Start Loop** — Sends `opencode\n` and the planner prompt to the planner terminal session
5. **Pause / Stop** — UI state updates correctly (`loop.status = "paused"` / `"failed"`)
6. **Close Loop** — Cleans up terminal sessions and removes loop from state
7. **Config modal** — Opens, accepts values, applies them to state
8. **Install modal** — Shows when opencode is not detected, allows rechecking
9. **Prompt editing** — Toggle prompt editor per phase, edit draft, save/cancel

---

## What Does NOT Work (Requires Backend / Integration)

1. **Phase auto-advancement** — Loop does not progress from Planner → Executor → Validator → Critic automatically
2. **Terminal output routing** — No handler consumes terminal output to detect phase completion
3. **Model selection** — Selected models are ignored during execution
4. **Iteration looping** — After Critic completes, the loop does not restart with a new iteration
5. **State persistence** — Loop state is lost on refresh
6. **Backend opencode check** — No robust backend-side opencode availability verification
7. **Backend invoke actions** — No backend handler for any looper-specific operations

---

## Architecture Summary

```
Frontend Only (No Backend)
├── manifest.ts         ✅
├── state.ts            ✅
├── actions.ts          ✅ (frontend-only logic)
├── bindings.ts         ✅
├── index.tsx           ✅
└── styles.css          ✅

Backend Registration Only (No Logic)
├── workspace_tools/mod.rs   ✅ (registered as workspace tool)
├── registry.ts              ✅ (in TOOL_ORDER)
├── viewBuilder.ts           ✅ (renders looper views)
└── workspaceLifecycle.ts   ✅ (calls ensureLooperInit)

No Backend Implementation
├── tools/invoke/looper.rs   ❌ (missing)
├── agent_tools/looper.rs     ❌ (missing)
└── No IPC handlers for looper-specific operations
```

---

## Recommendations for Testing

To test the looper today, you can:

1. **Create a loop** via the splash form
2. **Open the Terminal tab** to see the 4 phase sessions created
3. **Click Start Loop** to send the planner prompt to the planner terminal
4. **Manually interact** with the opencode session in the planner terminal
5. **Observe** that the UI updates for pause/stop/close

You **cannot** currently:
- Have the loop automatically advance phases
- Persist loop state across refreshes
- Use model selection to control which model each phase uses
- Run multiple iterations automatically
