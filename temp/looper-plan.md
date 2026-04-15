# Looper Tool - Functional Completion Plan

## Architecture Overview

The Looper tool needs a backend-driven architecture similar to the Flow tool. Currently it is entirely frontend-driven with no backend invoke handlers, no event handling, and no phase auto-advancement.

### Reference Architecture: Flow Tool

The Flow tool provides the pattern to follow:

```
Frontend                          Backend
───────────────────────────────────────────────────────────────────────
flow/runtime.ts              →  flow.rs (invoke handler)
  applyFlowEvent()                + FlowHandler service
  buildFlowStartRequest()         + Terminal session management
                                 → Events: flow.run.*, flow.step.*
flow/actions.ts              →  toolInvoke() IPC
  startFlowRun()                 → Backend creates terminal sessions
  stopFlowRun()                  → Backend emits events
  pauseFlowRun()                 ← Frontend receives events
  ...
                                 → Terminal output routed via
bootstrapFlowBridge.ts            maybeHandleFlowPhaseTerminalEvent()
  createFlowPhaseTerminalEventHandler()
```

---

## Phase 1: Backend Invoke Handler

### 1.1 Create `src-tauri/src/tools/invoke/looper.rs`

**Actions to register:**

| Action | Purpose |
|--------|---------|
| `start` | Create a new loop, initialize phases, start planner |
| `stop` | Stop a running loop |
| `pause` | Pause a running loop |
| `resume` | Resume a paused loop |
| `status` | Get current loop status |
| `list` | List all loops |
| `advance` | Manually advance to next phase |
| `check-opencode` | Check if OpenCode CLI is installed |

**Invoke functions** (mirroring `flow.rs`):

```rust
fn invoke_start(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_stop(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_pause(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_resume(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_status(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_list(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_advance(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
fn invoke_check_opencode(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture
```

### 1.2 Register in `src-tauri/src/tools/invoke/mod.rs`

```rust
pub mod looper;  // Add

pub fn build_registry() -> InvokeRegistry {
    let mut registry = InvokeRegistry::new();
    flow::register(&mut registry);
    files::register(&mut registry);
    web_search::register(&mut registry);
    looper::register(&mut registry);  // Add
    registry
}
```

### 1.3 Request/Response Contracts

**`LooperStartRequest`:**
```rust
struct LooperStartRequest {
    correlationId: String,
    loopId: String,           // frontend-generated ID
    iteration: i32,
    cwd: String,
    taskPath: String,
    specsGlob: String,
    maxIterations: i32,
    phaseModels: HashMap<String, String>,  // phase -> model
    projectName: String,
    projectType: String,
    projectIcon: String,
    projectDescription: String,
}
```

**`LooperStatusResponse`:**
```rust
struct LooperStatusResponse {
    loopId: String,
    status: String,          // "idle" | "running" | "paused" | "completed" | "failed"
    activePhase: String,
    phases: HashMap<String, LooperPhaseStatus>,
    reviewResult: Option<String>,
}
```

---

## Phase 2: Backend LooperHandler Service

### 2.1 Create `src-tauri/src/tools/looper_handler.rs`

The `LooperHandler` is the core service that owns loop execution:

```rust
pub struct LooperHandler {
    // Active loops by ID
    loops: RwLock<HashMap<String, LooperLoop>>,

    // Terminal session management
    terminal_registry: TerminalRegistryHandle,

    // Event emission
    event_sender: broadcast::Sender<AppEvent>,

    // Config
    opencode_path: Option<String>,
}

pub struct LooperLoop {
    pub id: String,
    pub iteration: i32,
    pub status: LoopStatus,
    pub active_phase: Option<LooperPhase>,
    pub phases: HashMap<LooperPhase, LooperPhaseState>,
    pub review_result: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
}
```

### 2.2 Phase State Machine

Each phase (`planner`, `executor`, `validator`, `critic`) transitions through states:

```
idle → running → complete
            └→ error
            └→ blocked (waiting for input or external signal)
```

### 2.3 Terminal Session Management

**Backend must own terminal sessions for each phase:**

1. When `start` is invoked → create 4 terminal sessions (one per phase) via `TerminalRegistryHandle`
2. Send opencode + prompt to planner session
3. Track session IDs in `LooperPhaseState`
4. When phase completes → close that session, create next phase session
5. When loop completes → close all sessions

**Session lifecycle:**

```
createSessions(loop) → [planner_session, executor_session, validator_session, critic_session]
startPlanner(sessionId, prompt) → send "opencode\n" + prompt
advancePhase(loop, next_phase) → close prev, send opencode + prompt to next
stopLoop(loop) → close all sessions
```

### 2.4 Phase Completion Detection

**Option A: Terminal exit detection**
- When a terminal session exits (via `terminal.exit` event), check if it matches a looper phase session
- If planner exits → advance to executor
- If executor exits → advance to validator
- If validator exits → advance to critic
- If critic exits → loop complete

**Option B: Output pattern matching**
- Monitor terminal output for patterns like:
  - Planner: "plan written" or "implementation_plan.md updated"
  - Executor: "work_summary.txt written" or "implementation complete"
  - Validator: "validation complete" with exit code
  - Critic: "SHIP" or "REVISE" decision

**Recommendation:** Use Option A (exit detection) as primary, Option B (output patterns) as fallback for edge cases.

### 2.5 OpenCode Availability Check

Move from frontend shell workaround to backend command:

```rust
fn check_opencode_installed() -> bool {
    let output = std::process::Command::new("sh")
        .args(["-c", "command -v opencode"])
        .output();

    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}
```

---

## Phase 3: Backend Events

### 3.1 Define Looper Event Actions

| Event | When |
|-------|------|
| `looper.loop.start` | Loop iteration starts |
| `looper.loop.complete` | Loop iteration completes (critic done) |
| `looper.loop.failed` | Loop iteration fails |
| `looper.phase.start` | Phase starts running |
| `looper.phase.progress` | Phase emits progress output |
| `looper.phase.complete` | Phase completes (terminal exits) |
| `looper.phase.error` | Phase errors |
| `looper.check-opencode.result` | OpenCode availability result |

### 3.2 Event Payload Structure

```rust
struct LooperPhaseEventPayload {
    loop_id: String,
    iteration: i32,
    phase: String,
    status: String,
    session_id: Option<String>,
    message: Option<String>,
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i32>,
    result: Option<String>,      // e.g., "SHIP" or "REVISE" from critic
    error: Option<String>,
}

struct LooperLoopEventPayload {
    loop_id: String,
    iteration: i32,
    status: String,
    active_phase: Option<String>,
    review_result: Option<String>,
    error: Option<String>,
}
```

---

## Phase 4: Frontend Runtime (Event Handling)

### 4.1 Create `frontend/src/tools/looper/runtime.ts`

Mirror `flow/runtime.ts`:

```typescript
export function applyLooperEvent(slice: LooperToolState, event: AppEvent): void {
  if (!event.action.startsWith("looper.")) return;

  const payload = parseLooperPayload(event);
  if (!payload) return;

  if (event.action === "looper.loop.start") {
    // Ensure loop exists in state
    // Update status to running
  }

  if (event.action === "looper.phase.start") {
    // Update phase status to running
    // Update substeps
  }

  if (event.action === "looper.phase.complete") {
    // Update phase status to complete
    // Update substeps
  }

  if (event.action === "looper.phase.progress") {
    // Update phase output/transcript
  }

  if (event.action === "looper.loop.complete") {
    // Update loop status
    // Set reviewResult if critic completed
  }
}
```

### 4.2 Create Looper Event Handler

Create `frontend/src/tools/host/looperEvents.ts`:

```typescript
export function applyLooperRuntimeEvent(
  slice: LooperToolState,
  event: AppEvent,
  scheduleRefresh: () => void
): void {
  applyLooperEvent(slice, event);
  if (event.action.startsWith("looper.")) {
    scheduleRefresh();
  }
}
```

### 4.3 Terminal Output Routing

Create `frontend/src/tools/host/looperTerminalBridge.ts` (analogous to `bootstrapFlowBridge.ts`):

```typescript
export function createLooperTerminalEventHandler(deps: {
  state: LooperToolState;
  terminalManager: TerminalManager;
  looperPhases: readonly LooperPhase[];
  // ...
}) {
  // Route terminal output to looper phase sessions
  // Write output to matching looper phase terminal
  // On terminal.exit, check if it's a looper phase session → trigger phase advance
}
```

---

## Phase 5: Integrate Event Handling in `main.ts`

### 5.1 Wire up looper event handler

In `main.ts`, similar to how flow is wired:

```typescript
import { applyLooperRuntimeEvent } from "./tools/host/looperEvents";
import { createLooperTerminalEventHandler } from "./tools/host/looperTerminalBridge";

// In the main event loop (handleCoreAppEvent deps):
applyLooperRuntimeEvent: (event) => applyLooperRuntimeEvent(state.looperState, event, scheduleLooperRefresh),
maybeHandleLooperTerminalEvent: createLooperTerminalEventHandler({ ... }),
```

### 5.2 Call looper event handlers

In `handleCoreAppEvent` after flow handling:

```typescript
deps.applyLooperRuntimeEvent(event);
void deps.maybeHandleLooperTerminalEvent(event);
```

---

## Phase 6: Update Frontend Actions to Use IPC

### 6.1 Rewrite `frontend/src/tools/looper/actions.ts`

Replace direct terminal manipulation with IPC calls:

**Before (current):**
```typescript
export async function startLoop(state, deps, loopId) {
  // Directly create terminal session
  const session = await deps.terminalManager.createSession(opts);
  // Directly send input
  await deps.client.sendTerminalInput({ sessionId, input: "opencode\n", ... });
}
```

**After:**
```typescript
export async function startLoop(state, deps, loopId) {
  const loop = state.loops.find(l => l.id === loopId);
  if (!loop) return;

  const request = buildLooperStartRequest(state, loop, deps.nextCorrelationId());
  const response = await deps.client.toolInvoke({
    toolId: "looper",
    action: "start",
    payload: request,
  });

  if (!response.ok) {
    state.statusMessage = `Start failed: ${response.error}`;
    return;
  }

  // Backend now owns terminal sessions
  // Frontend just updates state from events
}
```

### 6.2 Backend-provided state initialization

On tab activation, frontend should request current state from backend:

```typescript
export async function refreshLooperState(state, deps) {
  const response = await deps.client.toolInvoke({
    toolId: "looper",
    action: "list",
    payload: { correlationId: deps.nextCorrelationId() },
  });

  if (response.ok) {
    state.loops = response.data.loops;
    state.activeLoopId = response.data.loops[0]?.id ?? null;
  }
}
```

---

## Phase 7: Persistence

### 7.1 Backend Persistence

Store loop state in backend (not just memory):

```rust
// In LooperHandler or a separate LooperStore
struct LooperStore {
    loops: RwLock<HashMap<String, LooperLoop>>,
    persistence_path: PathBuf,
}

impl LooperStore {
    pub fn save(&self) -> Result<(), String> { ... }
    pub fn load(&self) -> Result<(), String> { ... }
}
```

### 7.2 Persist on state changes

- Save to disk on each state transition
- Load on application startup
- Frontend requests `list` on `ensureLooperInit`

---

## Phase 8: Fix Config/Splash Form Synchronization

### 8.1 Single Source of Truth

Remove the dual configuration paths. The splash form should be the single source for initial project setup, and the config modal should be the single source for runtime settings.

**Changes:**

1. **Splash form drafts** → used only for creating new loops
2. **Config modal** → used for runtime settings (cwd, taskPath, specsGlob, maxIterations)
3. **Applied config** (from modal) → stored in `state.cwd`, `state.taskPath`, etc.
4. **On page refresh** → config modal fields should be populated from applied config, not drafts
5. **Splash form** → should read initial values from applied config for non-project fields

**具体 changes in `frontend/src/tools/looper/actions.ts`:**

```typescript
export function openConfig(state: LooperToolState): void {
  // Populate drafts from APPLIED config, not from drafts
  state.configCwdDraft = state.cwd;
  state.configTaskPathDraft = state.taskPath;
  state.configSpecsGlobDraft = state.specsGlob;
  state.configMaxIterationsDraft = state.maxIterations;
  state.configOpen = true;
}

export function applyConfig(state: LooperToolState): void {
  // Apply to runtime config (the single source of truth for runtime settings)
  state.cwd = state.configCwdDraft;
  state.taskPath = state.configTaskPathDraft;
  state.specsGlob = state.configSpecsGlobDraft;
  state.maxIterations = state.configMaxIterationsDraft;
  state.configOpen = false;
}
```

---

## Phase 9: Phase Model Selection Integration

### 9.1 Pass Model Selection to Backend

The `phaseModels` from state must be passed to the backend invoke:

```typescript
function buildLooperStartRequest(state, loop, correlationId) {
  return {
    correlationId,
    loopId: loop.id,
    iteration: loop.iteration,
    // ... other fields
    phaseModels: { ...state.phaseModels },  // phase -> model mapping
    // Backend uses these when creating agent sessions
  };
}
```

### 9.2 Backend Uses Models Per Phase

When starting a phase, the backend should pass the selected model to the opencode invocation:

```rust
async fn start_phase(
    &self,
    loop_id: &str,
    phase: LooperPhase,
    model: Option<&str>,
) -> Result<(), String> {
    let model_arg = model.map(|m| format!("--model {}", m));
    // Send to terminal: opencode [--model <model>]
}
```

---

## Phase 10: Iteration Loop

### 10.1 After Critic Completes

When critic reports `SHIP` → loop complete.
When critic reports `REVISE` → start new iteration (executor phase again).

**Backend logic:**

```rust
if phase == "critic" {
    if let Some(result) = payload.result {
        if result == "SHIP" {
            loop.status = LoopStatus::Completed;
            loop.review_result = Some("ship".to_string());
        } else if result == "REVISE" {
            // Start new iteration
            loop.iteration += 1;
            loop.active_phase = Some(LooperPhase::Executor);
            // Reset executor phase, keep planner/validator results
        }
    }
}
```

### 10.2 Max Iterations Guard

Check against `maxIterations` before starting new iteration.

---

## Implementation Order

```
1. Backend invoke handler (looper.rs) with basic start/stop
2. LooperHandler service (looper_handler.rs)
3. Backend events for looper
4. Frontend runtime.ts + looperEvents.ts
5. Terminal output routing (looperTerminalBridge.ts)
6. Wire up in main.ts
7. Rewrite frontend actions.ts to use IPC
8. Backend persistence
9. OpenCode check backend
10. Config/splash form sync fix
11. Phase model integration
12. Iteration loop
```

---

## Key Files to Create

| File | Purpose |
|------|---------|
| `src-tauri/src/tools/invoke/looper.rs` | Backend invoke handler |
| `src-tauri/src/tools/looper_handler.rs` | Core loop execution service |
| `frontend/src/tools/looper/runtime.ts` | Event processing |
| `frontend/src/tools/host/looperEvents.ts` | Looper event handler wiring |
| `frontend/src/tools/host/looperTerminalBridge.ts` | Terminal output routing |

## Key Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/tools/invoke/mod.rs` | Register looper |
| `src-tauri/src/contracts.rs` | Add looper request/response types |
| `frontend/src/tools/looper/actions.ts` | Use IPC instead of direct terminal |
| `frontend/src/main.ts` | Wire up looper event handlers |
| `frontend/src/app/events.ts` | Add looper event handling |
| `frontend/src/tools/looper/state.ts` | Potentially add backend-sourced fields |
