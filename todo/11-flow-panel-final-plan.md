# Flow Panel — Final Plan
# Observable, Functional Ralph Loops + Open-Ended Workflows

_The single source of truth for what to build in the Flow system._

---

## Framing

The Flow panel already has:
- A working node graph editor (canvas, zoom/pan, snap grid, multi-select, grouping)
- Edge ports with role-based compatibility
- Autosave + import/export
- A backend execution engine (`execute_workflow_run`, `execute_node`, topo-ordered DAG)
- Per-node run tracking (`a2a_workflow_node_runs`)
- Observability events (`a2a:run_trace_chunk`)
- Run history and trace detail fetch

The goal is not to replace this. It is to:
1. **Narrow** — surface only what actually works reliably
2. **Harden** — make what works survive retries, crashes, and long durations
3. **Extend** — add the one new capability everything else depends on: agent delegation
4. **Observe** — make every loop visually legible in real time

---

## Part 1 — The Loop State Machine

### Replace ad-hoc run status with a formal state machine

Every loop run should move through well-defined states. No implicit transitions.

```
draft
  │ (user starts run)
  ▼
ready
  │ (scheduler picks up)
  ▼
running
  ├─(LLM node, HTTP node, bash node, etc. executing)
  │
  ├─(waiting for external signal, webhook, user confirmation)
  ▼
waiting_external
  │ (signal received)
  ▼
running  (continues)
  │
  ├─(node fails → retry policy says try again)
  ▼
retrying
  │ (backoff elapsed)
  ▼
running  (retries node)
  │
  ├─(user pauses)
  ▼
paused
  │ (user resumes)
  ▼
running  (from last checkpoint)
  │
  ├─(all nodes complete)   ─→  succeeded
  ├─(unrecoverable error)  ─→  failed
  └─(user or agent cancels) ─→ canceled
```

### What this requires in Rust

- Update `a2a_workflow_runs.status` to support all states above
- Add `execute_workflow_run` state machine transitions in `a2a/runtime.rs`
- Add `cmd_a2a_workflow_run_pause` and `cmd_a2a_workflow_run_resume` commands
- Add `cmd_a2a_workflow_run_cancel` with propagation to active node operations (kill running node task by CancellationToken)

### What this requires in the UI

- Run status badge in the Flow panel header showing current state with color
- Pause / Resume / Cancel buttons wired to the new commands
- State transitions reflected in run history

---

## Part 2 — Node Catalog Curation

### The single most important pre-launch change for Flow

The UI node palette currently shows nodes that are partially implemented, stubbed, or disabled in the runtime. This creates silent failures and breaks user trust.

### Action: Three-tier node classification

**Tier 1 — Stable (shown by default, usable in templates)**
- `core.start` / `core.end`
- `core.condition` (if/else routing)
- `core.loop` (bounded iteration)
- `core.merge` (wait for parallel branches)
- `ai.llm_query` (single-turn LLM call)
- `ai.agent_run` (multi-turn agent with tool use) ← new
- `ai.spawn_delegate` (delegate to specialist agent) ← new
- `util.read_file` / `util.write_file` (workspace-scoped)
- `util.bash` (sandbox mode, explicit elevation for non-sandbox)
- `http.request` (GET/POST/PUT/DELETE)
- `memory.read` / `memory.write`
- `data.transform` (map/filter/reduce over JSON)

**Tier 2 — Beta (shown with "beta" label, usable but not in default templates)**
- `db.sqlite` (local SQLite query)
- `notify.send_email`
- `trigger.webhook` (incoming)
- `trigger.schedule` (cron)

**Tier 3 — Hidden (not shown in UI, not usable until production-hardened)**
- MySQL, MongoDB, MSSQL, Redis connectors
- `util.execute_workflow` (inline subworkflow — re-enable after recursion guard)
- Any node with "experimental" in its implementation

### How to implement

- Add a `support_tier: "stable" | "beta" | "hidden"` field to the node type registry
- This registry lives in one place — Rust backend (the source of truth) — and is served to the frontend via a command
- The frontend renders only Tier 1 + Tier 2 nodes in the palette
- The backend blocks execution of Tier 3 nodes and returns a specific error code if encountered in a saved graph

---

## Part 3 — Idempotency Contracts

### Why this is non-negotiable

Long loops will retry failed steps. If a step sent an email, wrote a file, or made an API call before failing, a naive retry duplicates the effect. Without idempotency contracts, every side-effecting node is a landmine.

### The contract

For every node execution attempt, generate an **idempotency key**:
```
idempotency_key = sha256(run_id + node_id + attempt_number)
```

For Tier 1 stable nodes, the contract is:
- `util.write_file`: idempotent by nature (overwrite is safe)
- `util.bash`: **not idempotent** — mark as `non_retryable: true` by default unless user explicitly marks it retryable and idempotent
- `http.request` (POST/PUT/DELETE): pass idempotency key as `Idempotency-Key` header; log key in node-run record
- `notify.send_email`: store idempotency key; if last attempt succeeded (node-run record shows `completed`), skip on retry
- `ai.llm_query` / `ai.agent_run`: idempotent (same input → same attempt; retry is safe)

### What to add to the DB schema

```sql
ALTER TABLE a2a_workflow_node_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN attempt INTEGER DEFAULT 1;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN max_attempts INTEGER DEFAULT 3;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN backoff_ms INTEGER DEFAULT 2000;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN last_external_receipt TEXT;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN non_retryable INTEGER DEFAULT 0;
```

### What to add to the runtime

Before executing any side-effecting node:
1. Check if a `node_run` record for this `(run_id, node_id, attempt)` already exists with status `completed`
2. If yes → skip execution, return cached output (idempotent replay)
3. If no → execute, store idempotency_key and receipt on completion

---

## Part 4 — Durable Checkpointing

### Why loops need checkpoints

A 40-turn coding loop that crashes at turn 38 should resume from turn 38, not restart from turn 1. Checkpointing is what makes REPL loops practically useful.

### Checkpoint design

A checkpoint captures the **minimum state needed to resume**:
- Which node is currently executing
- The serialized `Session` context for any active agent node (turn history)
- The outputs of all completed nodes (so downstream nodes get correct inputs on resume)

```sql
CREATE TABLE IF NOT EXISTS flow_checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES a2a_workflow_runs(id),
    node_id TEXT NOT NULL,
    turn INTEGER,                    -- for agent nodes: which turn to resume from
    session_snapshot TEXT,           -- JSON: serialized Session for agent nodes
    completed_node_outputs TEXT,     -- JSON: { node_id -> output } for all completed nodes
    created_at INTEGER NOT NULL
);
```

### When to checkpoint

- After every completed node (write node output + updated completed set)
- For agent nodes (`ai.agent_run`, `ai.spawn_delegate`): every N turns (configurable, default 5)
- On pause command: write checkpoint immediately before pausing

### Resume logic

On `cmd_a2a_workflow_run_resume(run_id)`:
1. Load latest checkpoint for this run_id
2. Reconstruct in-progress state: which nodes are done (skip them), which node is active
3. For agent nodes: restore `Session` from `session_snapshot`
4. Continue execution from the checkpointed node

---

## Part 5 — Agent Delegation Node (The Core New Capability)

### This is what makes Ralph Loops possible

The new `ai.spawn_delegate` node type allows the primary agent (or the flow orchestrator) to hand a task to a specialist agent with a defined role, tool set, and output contract.

### Node configuration

```json
{
  "type": "ai.spawn_delegate",
  "config": {
    "role": "Software Architect",
    "system_prompt": "You are a senior software architect. Analyze the codebase and produce a detailed implementation plan as JSON.",
    "model": "${inputs.model || 'default'}",
    "tools": ["read", "ls", "grep", "find"],
    "max_turns": 15,
    "wait_for_completion": true,
    "output_schema": {
      "type": "object",
      "required": ["plan", "files_to_modify"]
    },
    "timeout_ms": 300000
  }
}
```

### What to build in Rust

In `a2a/runtime.rs`, add a new node executor for `ai.spawn_delegate`:

```rust
async fn execute_spawn_delegate_node(
    node_config: &NodeConfig,
    inputs: Value,
    run_id: &str,
    app_handle: &AppHandle,
    state: &AppState,
    cancel: CancellationToken,
) -> NodeResult {
    // 1. Build Agent from node_config (provider from AppState, tools by name)
    // 2. Start Agent::run_collect(task, None, Some(cancel_receiver))
    // 3. Stream agent events as a2a:run_trace_chunk sub-events
    // 4. On AgentEnd: extract final text/JSON output
    // 5. Validate against output_schema if provided
    // 6. Return structured NodeResult
}
```

This is the connection point between the flow system and the agent crate. The agent crate already has everything needed; this is the wiring.

### The `spawn_delegate` tool for the primary agent

Separately, the primary agent in chat should also be able to call this as a tool:

```rust
Tool: spawn_delegate {
    role: String,
    system_prompt: String,
    task: String,
    tools: Vec<String>,
    max_turns: i64,
    wait: bool,
}
```

This is available to any agent running via the agent crate, enabling the "primary agent delegates to specialist" pattern described in the Ralph Loop concept.

---

## Part 6 — Observable Flow Panel UI

### What the panel must show for a running loop

```
┌─────────────────────────────────────────────────────────┐
│  "Code Fix Loop" — Running  [Pause] [Cancel]            │
│  Turn 12/40 · 2m 34s elapsed · $0.08 used              │
├──────────────────────────────────────────────────────────┤
│  [✓] Start                                              │
│  [✓] Architect Agent    3 turns · 45s · plan ready     │
│  [↻] Implementer Agent  8 turns · 1m 49s · in progress │ ← active
│      └─ Tool: read src/auth.ts                          │
│      └─ Tool: write src/auth.ts                         │
│      └─ Thinking: "Need to update the JWT validator..." │
│  [ ] Tester Agent       waiting                         │
│  [ ] Reviewer Agent     waiting                         │
│  [ ] End                                                │
└──────────────────────────────────────────────────────────┘
```

### Live streaming requirements

For this to work, the backend must emit fine-grained events during agent node execution:

```
a2a:run_trace_chunk {
  run_id,
  node_id,
  event_type: "agent_turn_start" | "agent_thinking" | "agent_tool_call" |
              "agent_tool_result" | "agent_text_delta" | "agent_turn_end" |
              "node_completed" | "node_failed" | "node_retrying",
  payload: { ... }
}
```

These map directly to the existing `Event` enum in the agent crate — the bridge is emitting those events as `a2a:run_trace_chunk` sub-events during node execution.

### The node visualization

Each node in the graph should display its current state:
- **Waiting**: gray, dimmed
- **Running**: blue, animated border
- **Retrying**: yellow, retry count badge
- **Completed**: green checkmark
- **Failed**: red X with error tooltip
- **Paused**: yellow pause icon

For agent nodes that are running, expand a "live console" section showing the most recent text delta and tool call.

### The run history panel

Below or beside the graph: a timeline of all run attempts for this workflow, with status, duration, and a "view trace" button that opens a structured log of all events.

---

## Part 7 — Flow Templates

### Template structure

Each template is a JSON file that describes a complete workflow:

```json
{
  "id": "code-fix-loop",
  "name": "Code Fix Loop",
  "version": "1.0",
  "description": "Analyze a bug, implement a fix, run tests, and produce a review report.",
  "tags": ["coding", "stable"],
  "input_schema": {
    "type": "object",
    "required": ["task_description", "working_directory"],
    "properties": {
      "task_description": { "type": "string" },
      "working_directory": { "type": "string" }
    }
  },
  "nodes": [...],
  "edges": [...],
  "default_config": {
    "max_loop_turns": 40,
    "timeout_ms": 600000
  }
}
```

### Templates to ship at launch (4 only)

| Name | Stage sequence | Domain |
|---|---|---|
| **Code Fix Loop** | Analyst → Implementer → Tester → Reviewer | Engineering |
| **Business Analysis Loop** | Researcher → Analyst → Writer → Editor | Business |
| **Due Diligence Loop** | Collector → Verifier → Risk Scorer → Reporter | Finance/Legal |
| **Daily Assistant Loop** | Planner → Executor → Notifier | Personal |

Each template uses ONLY Tier 1 stable nodes. No exceptions.

### Template selection UI

When the user creates a new flow, show a template gallery:
- 4 built-in templates with preview diagrams
- "Start from scratch" blank canvas option
- Search/filter by tag

The primary agent in chat should also be able to call `flow.create_from_template(template_id, inputs)` to start a loop programmatically.

---

## Part 8 — Security and Safety

### Filesystem boundaries

All `util.read_file` and `util.write_file` node operations must be constrained to:
- The workspace directory associated with the current project
- OR an explicitly user-approved path (shown in the node config as a warning)

This is especially important on Windows where path separator issues amplify risk.

### Sandbox defaults

`util.bash` nodes:
- Default mode: `sandbox` (restricted to workspace, no network, no root commands)
- Elevated mode: requires explicit user confirmation dialog before run starts
- Log all bash invocations with full args in the node-run record

### Cancellation propagation

When a run is cancelled:
1. The active node's `CancellationToken` is fired
2. Any active `ai.agent_run` or `ai.spawn_delegate` node's agent loop receives the cancel signal
3. Any HTTP request is aborted
4. Any bash subprocess receives SIGTERM (SIGKILL after 3s)
5. The run status transitions to `canceled`
6. No new nodes start

---

## Part 9 — Pre-Launch Observability

### Startup health panel

Show on first load or from Help menu:

```
System Check:
  ✓ Database: OK
  ✓ Model endpoint: reachable (local llama-server at :8765)
  ✓ STT engine: whisper-rs loaded
  ✗ TTS engine: Kokoro daemon not running (voice TTS disabled)
  ✓ Writable directories: OK
  ✓ Workspace: /home/user/myproject
```

### Diagnostics export

One-click "Export diagnostics" button:
- Collects: last N log lines, system info, DB counts, current settings
- Strips: API keys, file contents, message content
- Exports: a ZIP the user can attach to a bug report

### Unified log schema for flow events

Every node execution should write a log line:
```json
{
  "ts": 1710000000,
  "run_id": "...",
  "node_id": "...",
  "attempt": 1,
  "event": "node_start | node_end | node_failed | node_retrying",
  "duration_ms": 1234,
  "error_class": "timeout | provider_error | schema_mismatch | null"
}
```

---

## Master Todo List

This is the definitive, ordered todo list for the Flow panel. Items are ordered by dependency and impact.

### BLOCKING (must complete before launch)

**B1 — Node catalog curation**
- [ ] Audit every node type in the UI palette against what `execute_node` actually implements
- [ ] Add `support_tier` field to node registry
- [ ] Serve node palette from backend (single source of truth)
- [ ] Hide Tier 3 nodes in UI; block their execution in backend
- [ ] Mark Tier 2 nodes with "beta" label in palette

**B2 — Unsupported node detection at run start**
- [ ] Before `execute_workflow_run` begins, scan all nodes in the graph
- [ ] If any Tier 3 node found: return error with specific node IDs listed
- [ ] Show error in UI with clear message: "These nodes are not yet supported: [list]"

**B3 — Run cancellation with propagation**
- [ ] Add `cmd_a2a_workflow_run_cancel(run_id)` Tauri command
- [ ] Add `CancellationToken` per active run in `A2ARuntime`
- [ ] Propagate cancel to active node executor (kills HTTP requests, bash processes, agent loops)
- [ ] Transition run status to `canceled` cleanly
- [ ] Wire Cancel button in Flow panel

**B4 — Idempotency for side-effecting nodes**
- [ ] Add DB columns: `idempotency_key`, `attempt`, `max_attempts`, `backoff_ms`, `non_retryable`, `last_external_receipt`
- [ ] Generate idempotency key = `sha256(run_id + node_id + attempt)` before each node execution
- [ ] For `http.request` POST/PUT/DELETE: pass as `Idempotency-Key` header
- [ ] For `notify.send_email`: check if previous attempt completed before re-sending
- [ ] For `util.bash`: mark `non_retryable = true` by default; log this clearly
- [ ] On retry: load previous node-run record; if `completed`, skip execution and return cached output

**B5 — Filesystem boundary enforcement**
- [ ] Constrain `util.read_file` / `util.write_file` to workspace root by default
- [ ] Reject paths outside workspace unless node has `elevated_mode: true`
- [ ] Add platform-safe path normalization (no string concatenation, use Path::join)

**B6 — Startup health panel (first-run trust)**
- [ ] On app startup, run capability checks: DB, model endpoint, STT, TTS, writable dirs
- [ ] Emit `startup:health` event with structured results
- [ ] Show health indicators in settings or help panel
- [ ] Disable voice buttons with tooltip if STT/TTS unavailable (not silent failure)

---

### HIGH PRIORITY (complete this week)

**H1 — Full loop state machine**
- [ ] Update `a2a_workflow_runs.status` enum to full state set
- [ ] Implement state transitions in `A2ARuntime`
- [ ] Add `cmd_a2a_workflow_run_pause` and `cmd_a2a_workflow_run_resume`
- [ ] Checkpoint before pause; restore from checkpoint on resume (see H3)
- [ ] Show state badges in Flow panel (color-coded)
- [ ] Show Pause / Resume / Cancel buttons in panel header

**H2 — Connect agent crate to flow LLM node execution**
- [ ] In `a2a/runtime.rs`, wire `ai.llm_query` node to call the agent crate's `run_single_turn`
- [ ] Wire `ai.agent_run` node to call full `Agent::run_collect` loop
- [ ] Stream agent events as `a2a:run_trace_chunk` sub-events during execution
- [ ] Cancellation from run cancel propagates into agent cancel watch channel

**H3 — Durable checkpointing**
- [ ] Create `flow_checkpoints` table in `a2a.db`
- [ ] Write checkpoint after each completed node (node_id + output)
- [ ] Write checkpoint every 5 turns for agent nodes (session snapshot)
- [ ] Write checkpoint on pause
- [ ] On resume: load checkpoint, skip completed nodes, restore agent session if applicable

**H4 — `ai.spawn_delegate` node type**
- [ ] Define `SpawnDelegateConfig` struct (role, system_prompt, tools, max_turns, output_schema)
- [ ] Implement `execute_spawn_delegate_node` in `a2a/runtime.rs` using agent crate
- [ ] Add `spawn_delegate` to Tier 1 node catalog
- [ ] Add node UI component in Flow panel (shows role, tool list, turn progress)
- [ ] Validate output against `output_schema` if provided; log schema mismatch as warning not hard failure

**H5 — Per-node live visualization in Flow panel**
- [ ] Node card shows current state (waiting/running/retrying/done/failed) with color
- [ ] Active agent nodes show live: most recent text delta, current tool call
- [ ] Completed nodes show: turn count, duration, short output preview
- [ ] Failed nodes show: error class, attempt number, "retry" button if retryable

**H6 — Run history and trace viewer**
- [ ] Run history sidebar: list of all runs with status, start time, duration
- [ ] Click run → open trace viewer showing event timeline
- [ ] Trace viewer shows per-node events: start, tool calls, text output, end, errors
- [ ] Export trace as JSON button

**H7 — 4 launch templates**
- [ ] Create JSON definitions for: Code Fix Loop, Business Analysis Loop, Due Diligence Loop, Daily Assistant Loop
- [ ] Bundle as app resources (served via a new `cmd_flow_list_templates` command)
- [ ] Template gallery UI: grid with preview + "Use this template" button
- [ ] Each template uses only Tier 1 stable nodes
- [ ] Each template has strict `input_schema` shown as a form before run starts

**H8 — Unified log schema**
- [ ] Define `FlowLogEntry` struct in Rust
- [ ] Emit structured log entry at: node_start, node_end, node_failed, node_retrying
- [ ] Fields: ts, run_id, node_id, attempt, event, duration_ms, error_class
- [ ] Include these in the diagnostics export bundle

---

### MEDIUM PRIORITY (post-launch week 1)

**M1 — Diagnostics export bundle**
- [ ] "Export diagnostics" button in settings or help
- [ ] Bundle: recent logs, system info, DB row counts, health check results
- [ ] Strip: API keys, message content, file contents
- [ ] Output: .zip download

**M2 — `spawn_delegate` as primary agent tool**
- [ ] Add `SpawnDelegateTool` to the agent crate's built-in tools
- [ ] Wire to the same `execute_spawn_delegate_node` logic in the Tauri backend
- [ ] Primary agent in chat can call it to start a sub-agent loop
- [ ] Result appears in Flow panel as a new run under the current session

**M3 — specta type generation**
- [ ] Add `specta` + `tauri-specta` dependencies
- [ ] Annotate all Tauri command input/output types and event payloads
- [ ] Generate `src/bindings.ts` at build time
- [ ] Frontend imports types from bindings instead of hand-written interfaces

**M4 — Windows platform fixes**
- [ ] PID safety: verify process name before taskkill
- [ ] Console window: `CREATE_NO_WINDOW` on all subprocess spawns
- [ ] Long path: enable in Windows manifest
- [ ] Path separator: audit all string path constructions in engine_installer and audio scripts

**M5 — macOS code signing / Gatekeeper**
- [ ] Decision: sign + notarize OR document workaround prominently in README
- [ ] If signing: add notarization step to CI release workflow
- [ ] If not signing: add `xattr` command to first-run instructions; add in-app note

**M6 — Startup progress screen**
- [ ] Show window immediately after DB init
- [ ] Emit `startup:progress { step, message }` events from async background tasks
- [ ] Frontend renders loading screen driven by events
- [ ] Transition to main UI when `startup:complete` fires

---

### DEFERRED (post-launch)

- Multi-worker scale-out (multiple flow runs in parallel workers)
- Template marketplace / community-submitted templates
- Advanced graph features: subworkflows, versioning, collaboration
- Broad connector library (MySQL, MongoDB, Redis, etc.)
- Vector memory / embedding-based context retrieval
- Voice integration inside agent nodes (speak outputs, receive voice commands mid-loop)
- `specta` for full IPC type safety (start with new commands)
- Python-free TTS via tract-onnx Kokoro
- Agent loop parallel tool execution

---

## Definition of Done for Launch

A Ralph Loop launch is ready when:

1. **Code Fix Loop template runs end-to-end** on all three platforms without manual intervention
2. **Unsupported nodes are blocked** — no silent failures from unimplemented node types
3. **Cancellation works** — cancel button stops execution cleanly within 5 seconds
4. **Side-effecting nodes are idempotent or marked non-retryable** — no duplicate emails/writes on retry
5. **Live node visualization shows** — user can watch the loop progress node-by-node
6. **A crashed loop can be observed** — trace export shows what happened and where it stopped
7. **Startup health check passes** on a fresh install showing which capabilities are available
