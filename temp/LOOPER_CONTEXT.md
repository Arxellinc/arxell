# Looper Tool — Implementation Context

## Overview

The **Looper tool** is a multi-agent orchestration system with 4 phases:
- **Planner** → **Executor** → **Validator** → **Critic**

It's inspired by the Ralph Wiggum technique — a bash loop that drives iterative software development using an LLM.

**Goal:** Make the Looper tool fully functional in arxell-lite. Backend owns terminal sessions and phase state machine; frontend observes via events.

---

## Architecture

### Backend (Rust)

**Key Files:**
```
src-tauri/src/
├── tools/
│   ├── looper_handler.rs        # Core LooperHandler service (811 lines)
│   └── invoke/
│       └── looper.rs           # IPC invoke handler
├── ipc/
│   └── looper.rs               # LooperCommandHandler wrapper
├── app/
│   └── mod.rs                  # AppContext wires everything together
├── contracts.rs                # All request/response types
└── main.rs                     # Tauri app entry point
```

**Terminal Event Flow:**
```
TerminalService (terminal_service.rs)
  └─► emits "terminal.exit" to EventHub
        └─► LooperHandler::start_event_listener() (background task)
              └─► on_terminal_exit(session_id, exit_code)
                    └─► do_advance() → starts next phase
```

**Phase Transition Flow:**
```
start() → creates 4 terminal sessions (one per phase)
       → starts Planner phase
       → when Planner terminal exits:
             on_terminal_exit() → do_advance() → starts Executor
       → when Executor terminal exits:
             on_terminal_exit() → do_advance() → starts Validator
       → when Validator terminal exits:
             on_terminal_exit() → do_advance() → starts Critic
       → when Critic terminal exits:
             on_terminal_exit() → completes loop OR starts new iteration
```

### Frontend (TypeScript)

**Key Files:**
```
frontend/src/
├── tools/
│   └── looper/
│       ├── state.ts      # LooperToolState, LooperPhase types
│       ├── actions.ts    # IPC-based actions (start, stop, pause, close)
│       ├── bindings.ts   # Click/input handlers
│       ├── index.tsx     # Render functions
│       ├── runtime.ts    # applyLooperEvent() processes backend events
│       └── manifest.ts   # Tool manifest
├── tools/host/
│   ├── looperEvents.ts   # applyLooperRuntimeEvent() bridge
│   └── looperTerminalBridge.ts  # Routes terminal output to phase sessions
├── app/
│   └── events.ts         # handleCoreAppEvent() — event pipeline
└── main.ts               # App initialization, looper wiring
```

---

## What Works

- ✅ Backend compiles (warnings only)
- ✅ Frontend compiles (1 pre-existing type error unrelated to looper)
- ✅ LooperHandler created with 4 phases and substeps
- ✅ Terminal sessions created for all 4 phases on start
- ✅ `start_event_listener()` spawns background task listening for `terminal.exit`
- ✅ `on_terminal_exit()` routes to correct phase and calls `do_advance()`
- ✅ Frontend `applyLooperEvent()` processes backend events
- ✅ IPC invoke handlers wired (start, stop, pause, advance, status, list, close, check-opencode)
- ✅ Frontend `ensureLooperInit` uses IPC `check-opencode` (no probe terminal)
- ✅ `refreshLooperState()` calls IPC `list` to sync from backend

---

## What's NOT Working / What's Missing

### 1. Iteration Looping (HIGH PRIORITY)
**Current:** When Critic finishes, loop status is set to `Completed` and that's it.

**Should be:** Critic reads output, decides SHIP or REVISE. If REVISE:
- Increment iteration counter
- Reset all phase statuses to Idle
- Start a new Planner phase

**Location:** `on_terminal_exit()` in `looper_handler.rs` line ~670

### 2. Phase Model Integration (MEDIUM)
**Current:** `phase_models` is stored but never used when creating terminal sessions.

**Should be:** When creating a terminal session in `create_phase_sessions()`, use the model from `phase_models[phase]` if set.

**Location:** `create_phase_sessions()` in `looper_handler.rs` line ~425

### 3. Back-pressure Gates (HIGH PRIORITY)
**Ralph Wiggum principle:** After Executor, tests must pass before Critic can SHIP.

**Should be:** Validator runs tests/lint/typecheck. If any fail, Critic should return REVISE on next iteration.

**Location:** Validator phase prompt in `DEFAULT_PROMPTS` (`looper_handler.rs` line ~57)

### 4. Auto-commit (HIGH PRIORITY)
**Ralph Wiggum principle:** Every iteration commits so you can `git reset --hard` if things go wrong.

**Should be:** After Executor completes successfully (tests pass), auto-git-commit the changes.

**Not yet implemented anywhere.**

### 5. Persistence (MEDIUM)
**Current:** Loop state is in-memory only. App restart = loops lost.

**Should be:** Persist loop state to disk (SQLite or JSON file) for recovery.

**Not yet implemented.**

### 6. stopLoop Behavior (LOW)
**Current:** Sets status to "failed" but doesn't properly close terminal sessions.

**Should be:** Close all phase terminals, emit `looper.loop.failed` with proper details.

**Location:** `stop()` in `looper_handler.rs` line ~237

---

## Compilation Commands

```bash
# Backend (from src-tauri/)
cargo check --features tauri-runtime

# Frontend (from frontend/)
npm run check
```

---

## Key Patterns

### Backend Event Emission
```rust
self.emit_event(
    &correlation_id,
    "looper.phase.start",
    EventStage::Complete,
    EventSeverity::Info,
    json!({ "loopId": loop_id, "phase": phase, "sessionId": session_id }),
);
```

### IPC Invoke Registration (tools/invoke/looper.rs)
```rust
pub fn register(registry: &mut InvokeRegistry) {
    registry.register("looper", &["start"], invoke_start);
    registry.register("looper", &["stop"], invoke_stop);
    // etc.
}
```

### Frontend Event Processing (tools/looper/runtime.ts)
```typescript
export function applyLooperEvent(state: LooperToolState, event: AppEvent, scheduleRefresh: () => void): void {
    if (event.action === "looper.loop.start") { /* ... */ }
    if (event.action === "looper.phase.start") { /* ... */ }
    if (event.action === "looper.phase.transition") { /* ... */ }
    scheduleRefresh();
}
```

### LooperHandler Internal Structure
```rust
pub struct LooperHandler {
    hub: EventHub,
    terminal: Arc<TerminalService>,  // direct access, not TerminalCommandHandler
    loops: RwLock<HashMap<String, LooperLoop>>,
}

struct LooperLoop {
    id: String,
    iteration: i32,
    status: LooperLoopStatus,
    active_phase: Option<String>,
    phases: HashMap<String, PhaseState>,
    // ...
}
```

---

## LooperLoopStatus Enum
```rust
pub enum LooperLoopStatus {
    Running,
    Paused,
    Completed,
    Failed,
}
```

## LooperPhaseStatus Enum
```rust
pub enum LooperPhaseStatus {
    Idle,
    Running,
    Complete,
}
```

---

## Ralph Wiggum Technique (Reference)

Geoff Huntley's approach for turning an LLM into an autonomous developer:

1. **Bash loop** drives outer iteration
2. **PROMPT_plan.md** / **PROMPT_build.md** for planning vs building modes
3. **AGENTS.md** = validation commands (test, lint, typecheck)
4. **IMPLEMENTATION_PLAN.md** = shared state on disk (single source of truth)
5. **specs/*.md** = one file per JTBD topic
6. **Back-pressure is non-optional** — tests gate every commit
7. **Auto-commit every iteration** for rollback capability

### Key Lessons for Our Looper

| Ralph Wiggum | Our Looper |
|--------------|------------|
| Back-pressure testing gates | Validator phase should fail = REVISE |
| Auto-commit every iteration | Not yet implemented |
| Plan file as persistent state | Not yet implemented |
| Gap analysis before planning | Planner should do this |

---

## Pre-existing Issues

### TypeScript Error (unrelated to looper)
```
src/main.ts(566,3): error TS2322: Type 'string' is not assignable to type 'WorkspaceTab'
```
`loadPersistedWorkspaceTab` returns `string` but state expects `WorkspaceTab`. Pre-existing bug.

---

## Next Steps (Priority Order)

1. **Iteration looping** — implement SHIP/REVISE decision in `on_terminal_exit()`
2. **Back-pressure gates** — wire Validator test results to Critic decision
3. **Auto-commit** — git commit after Executor completes
4. **Phase model integration** — use `phase_models` when creating sessions
5. **Persistence** — disk persistence for loop state
6. **stopLoop fix** — properly close terminals
