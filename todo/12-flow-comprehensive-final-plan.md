# Flow Panel — Comprehensive Final Plan
# Observable Ralph Loops, Open-Ended Workflows, and Autonomous Model Delegation

_This is the single authoritative planning document for the Flow system._
_Supersedes: notes/04, notes/05, todo/04, todo/05, todo/11._

---

## 0. What Already Exists (Ground Truth)

Before planning anything new, it's important to be precise about what the current codebase already has:

**Backend (Rust):**
- `execute_workflow_run` + `execute_node` in `a2a/runtime.rs` — a working execution engine
- Topological DAG ordering with cycle detection
- `a2a_workflow_node_runs` table for per-node execution tracking
- `a2a:run_trace_chunk` + `a2a:workflow_changed` event emission
- Global (4) + per-workflow (2) concurrency limits
- Run timeout handling
- Tool gateway with policy matrix

**Frontend (FlowPanel.tsx, 3,651 lines):**
- Full canvas editor: zoom, pan, marquee select, grouping, snap grid
- 44+ node types across 8 palette sections
- **12 ports per node** — 6 flow ports (left/right, circle, green), 3 agent ports (top, square, blue), 3 binding ports (bottom, square)
- Port compatibility enforcement + max-connections limits
- Connector picker modal for memory, skills, tools on bottom ports
- Node inspector: left input JSON, center params editor + test, right output JSON
- Autosave (800ms debounce), import/export JSON
- Context menu: **"Change Model", "Add API", "Add Skill", "Add Memory", "Add Tool"** already exist
- Model badge displayed on nodes
- `flowExecutionStore` tracking per-node `"idle" | "running" | "succeeded" | "failed"` state

**What this means:** The structural groundwork is in place. The top agent ports (`agent_1`, `agent_2`, `agent_3`) are already rendered and clickable. "Add API" is already in the right-click context menu. The node inspector already shows input/output JSON. **None of these need to be built — they need to be wired to real behavior.**

---

## 1. The Core Design: Top Connector Model Routing

### The Three Top Square Ports — Redefined

The existing `agent_1`, `agent_2`, `agent_3` top ports are currently general "agent binding" ports. We give them specific semantic roles:

```
┌─────────────────────────────────────────┐
│    [agent_1]   [agent_2]   [agent_3]    │  ← TOP: Model routing ports (square, blue)
│       ↓           ↓           ↓         │
│   PRIMARY     EVALUATOR   DELEGATE      │
│   model       model       model         │
├─────────────────────────────────────────┤
│          [AI Agent Node]                │
│   role: "Software Architect"            │
│   tools: read, grep, find               │
│   max_turns: 10 · acceptance: schema    │
├─────────────────────────────────────────┤
│ [flow_in_1]              [flow_out_1]   │  ← SIDES: Data flow (circle, green)
│ [flow_in_2]              [flow_out_2]   │
├─────────────────────────────────────────┤
│  [memory_1]  [skills_1]   [tools_1]    │  ← BOTTOM: Resource binding (square)
└─────────────────────────────────────────┘
```

**Port roles:**

| Port | Role | Purpose |
|---|---|---|
| `agent_1` (top-left) | **PRIMARY** | The model that runs this agent's main inference turns |
| `agent_2` (top-center) | **EVALUATOR** | A model used to grade this node's output for quality |
| `agent_3` (top-right) | **DELEGATE** | A model this agent can spawn sub-tasks to |

### Model Provider Nodes

A new node family: `model.*`

These are small, configuration-only nodes that represent a model available in the app. They connect to agent nodes via the top ports. They have no execution logic themselves — they are routing declarations.

```
┌─────────────────────┐
│   model.api         │
│   Claude Sonnet 3.5 │
│   $3/M · 200k ctx   │
└─────────────────────┘
        │ (agent_1 connection)
        ▼
┌─────────────────────┐
│   AI Agent Node     │  ← uses Claude Sonnet for its primary turns
└─────────────────────┘
```

**Model node types (Tier 1 stable):**
- `model.local` — the currently loaded llama-server model
- `model.api` — a specific API configuration from the API panel (Claude, GPT-4, Gemini, etc.)
- `model.auto` — ARX selects automatically based on task complexity and budget

**Model node renders:**
- Name + provider logo/color
- Speed estimate (tokens/sec or latency class)
- Cost per token or "local (free)"
- Last availability check status (green/red dot)
- Click → opens API panel config for that model

**How "Add API" works (already in context menu):**
Right-clicking an agent node → "Add API" → opens a picker showing all models configured in the API panel → selecting one creates a `model.api` node connected to `agent_1` (primary). The user can then drag the connection to `agent_2` or `agent_3` if they want it as evaluator or delegate instead.

---

## 2. Autonomous Delegation: When and How

### The Decision Logic

An agent node with a connected `agent_3` (DELEGATE) port can autonomously hand off sub-tasks. The delegation logic is configurable in node params:

```json
{
  "delegation_config": {
    "enabled": true,
    "trigger_mode": "complexity | confidence | task_type | always | never",
    "complexity_threshold": 0.75,
    "confidence_threshold": 0.65,
    "task_type_triggers": ["code_generation", "data_analysis", "web_research"],
    "max_delegate_turns": 15,
    "delegate_output_schema": { ... }
  }
}
```

**Trigger modes:**

| Mode | When delegation fires |
|---|---|
| `complexity` | Agent self-assesses input as above threshold |
| `confidence` | After a turn, agent's self-reported confidence is below threshold |
| `task_type` | System prompt / input contains a tagged task type |
| `always` | Every invocation immediately delegates to the connected model |
| `never` | Delegation disabled (default if no `agent_3` connected) |

**What the agent says to trigger delegation:**
The agent node's system prompt includes a structured delegation block when `delegation_config.enabled = true`:

```
When you determine that a sub-task requires specialized capability beyond your current
context, output a delegation request in this format:
<delegate>
  task: [precise description of what you need done]
  expected_output: [schema or description]
  context: [relevant context the delegate needs]
</delegate>

You will receive the delegate's result as a tool response. Evaluate it and proceed.
```

The runtime parses `<delegate>` blocks from agent output, routes the task to the connected `agent_3` model, and returns the result as a tool result in the agent's next turn.

### When Results Are Good Enough — Acceptance Criteria

Every agent node has an `acceptance_criteria` block in params:

```json
{
  "acceptance_criteria": {
    "mode": "self_eval | schema_valid | test_pass | evaluator_grade | manual_gate | any_of",
    "min_turns": 1,
    "max_turns": 20,
    "self_eval": {
      "prompt": "Score 0-10 how completely you satisfied the task. If score >= 8, output TASK_COMPLETE.",
      "done_signal": "TASK_COMPLETE",
      "min_score": 8
    },
    "schema_valid": {
      "schema": { "type": "object", "required": ["plan", "files"] }
    },
    "test_pass": {
      "command": "npm test",
      "working_dir": "${inputs.working_directory}",
      "success_exit_code": 0
    },
    "evaluator_grade": {
      "rubric": "Does the output contain a complete plan with file paths and function signatures?",
      "min_score": 7,
      "uses_port": "agent_2"
    },
    "manual_gate": {
      "prompt_user": "Review the architect's plan and approve or reject.",
      "timeout_ms": 300000,
      "timeout_action": "auto_approve | auto_reject | pause"
    }
  }
}
```

**Evaluator flow (when `mode: "evaluator_grade"`):**
1. Agent produces output after its turn
2. Runtime calls the `agent_2` (EVALUATOR) model with the rubric + output
3. Evaluator model returns a structured grade: `{ score: 0-10, feedback: string, approved: bool }`
4. If `score >= min_score`: node completes with agent's output
5. If `score < min_score` and turns remaining: inject feedback into agent as user message, run another turn
6. If `score < min_score` and turns exhausted: node fails with grade details in error

**The evaluator call is a single turn** — it is not a full agent loop. It's a lightweight quality gate, not a competing agent.

---

## 3. The Architect/Manager Agent Panel

### UI Design

A collapsible floating panel anchored to the **bottom-right** of the Flow panel viewport.

**Collapsed state** (always visible):
```
┌───────────────────┐
│ 🏗 Flow Architect  ▲ │
└───────────────────┘
```

**Expanded state** (~360px wide × 420px tall):
```
┌──────────────────────────────────────────┐
│ 🏗 Flow Architect                    [ ▼ ]│
├──────────────────────────────────────────┤
│ [Analyze] [Validate] [Suggest]           │
├──────────────────────────────────────────┤
│                                          │
│  ANALYZE TAB:                            │
│  ┌──────────────────────────────────┐   │
│  │ This flow takes a task_description│   │
│  │ and working_directory as inputs.  │   │
│  │                                   │   │
│  │ Stage 1: Architect agent analyzes │   │
│  │ the codebase and produces a plan. │   │
│  │ Routes to Claude for main reasoning│  │
│  │                                   │   │
│  │ Stage 2: Implementer... [more]    │   │
│  └──────────────────────────────────┘   │
│                                          │
│  [Re-analyze]    [Copy description]      │
└──────────────────────────────────────────┘
```

### Three Tabs

**Tab 1 — Analyze**
- Sends the current workflow JSON to a short-context architect agent call (not a long loop — 1–3 turns max)
- Agent reads the graph structure and produces:
  - Plain-English description of what the flow does
  - List of **mandatory inputs** (required fields from the start node)
  - List of **expected outputs** (artifact types and names from the end node)
  - Description of each major stage in between
- Useful for onboarding new users, documentation, and sharing flows

**Tab 2 — Validate**
- Architect agent checks the flow for issues:
  - Unreachable nodes (no path from start to this node)
  - Tier 3 (unsupported) nodes in the graph
  - Agent nodes with no model connected (will use app default — flag as warning)
  - Side-effecting nodes (bash, email, HTTP POST) with no idempotency configuration
  - `manual_gate` nodes in unattended loops (will block if user not present)
  - Output schemas that don't match downstream input schemas
  - Missing acceptance criteria on agent nodes in long loops
- Produces a structured report: errors (blocks execution), warnings (risky), info (suggestions)
- **"Validate" button also runs automatically before any loop starts** — blocking errors prevent run start

**Tab 3 — Suggest**
- Architect agent reviews the flow and suggests improvements:
  - "Consider adding an evaluator model to the Implementer node to reduce iterations"
  - "The HTTP request node has no retry policy. Add max_attempts = 3."
  - "This loop has no budget cap. Set one in the header to prevent runaway spend."
  - "Connect a `model.api` to agent_1 of the Architect node — complex planning benefits from a stronger model"
- Suggestions are actionable: each has an "Apply" button that makes the change automatically

### Implementation

The Architect panel is powered by a single-call LLM invocation (not a full agent loop):
- Input: serialized workflow JSON + node type registry
- System prompt: "You are a workflow architect. Analyze this workflow graph and respond in structured JSON."
- Output schema: `{ description, inputs, outputs, stages, issues, suggestions }`
- Model: uses the app's primary model or the strongest available API model
- Runs on-demand (user clicks "Analyze" / "Validate" / "Suggest") or automatically on flow open

This is cheap (1 call, usually < 500 tokens), fast (2–5 seconds), and provides high value for understanding and debugging flows.

---

## 4. The Loop State Machine

All loop runs move through a formal state machine. State is persisted in `a2a_workflow_runs.status`.

```
draft
  │ cmd_flow_run_start
  ▼
validating  ─── (architect validation fails) ──→  draft  (with error list)
  │ (validation passes)
  ▼
ready
  │ (scheduler picks up — immediate in current design)
  ▼
running ◄────────────────────────────────────────────────────────────────────┐
  │                                                                           │
  ├─── (node finishes, more nodes pending) ────────────────────────────────── ┘
  │
  ├─── (manual_gate node reached) ──→ waiting_user
  │                                       │ (user approves/rejects)
  │                                       └──→ running (if approved)
  │                                       └──→ failed (if rejected)
  │
  ├─── (webhook trigger waiting) ──→ waiting_external
  │                                       │ (webhook fires)
  │                                       └──→ running
  │
  ├─── (node fails, retry policy active) ──→ retrying
  │                                            │ (backoff elapsed)
  │                                            └──→ running (retries node)
  │                                            └──→ failed (max retries exceeded)
  │
  ├─── (budget exceeded) ──→ budget_exceeded ──→ (emit event, pause or cancel per config)
  │
  ├─── (runtime exceeded) ──→ timed_out
  │
  ├─── (cmd_flow_run_pause) ──→ paused
  │                                 │ (checkpoint written)
  │                                 │ (cmd_flow_run_resume)
  │                                 └──→ running (from checkpoint)
  │
  ├─── (cmd_flow_run_cancel) ──→ canceling
  │                                  │ (active node receives CancellationToken)
  │                                  └──→ canceled
  │
  └─── (all terminal nodes complete) ──→ succeeded
```

---

## 5. The Header Run Controls Bar

When a workflow is **active** (running, paused, waiting), the header bar transforms from a workflow management toolbar to a **live run control bar**. When idle, it shows the standard workflow toolbar.

### Idle State (standard toolbar)
```
[workflow name ___________] [●saved] [+] [⌂] [⬆] [⬇] [⎘] [🗑]
```

### Active Run State (run control bar)
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ⏵ "Code Fix Loop"   RUNNING  turn 12  ·  $0.08 / $5.00  ·  4m 12s / 30:00      │
│                                                                                  │
│  Budget: [$5.00 ▼]  Runtime: [30min ▼]  Turns/agent: [20 ▼]  Model: [Auto ▼]   │
│  Auto-approve gates: [OFF ▼]   Confidence floor: [0.70 ▼]                        │
│                                                        [⏸ Pause] [⏹ Cancel]     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Header Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| **Budget cap** | `$0.00` – `$50.00` (dropdown + input) | `$5.00` | Halt loop if cumulative API spend exceeds this. Local model cost = $0. |
| **Runtime limit** | `5min` – `4h` (dropdown) | `30min` | Kill run if wall-clock time exceeds this |
| **Max turns / agent** | `5` – `100` (slider) | `20` | Per-agent-node max turns (overrides node-level if lower) |
| **Model routing** | `Auto / Local only / API preferred / Custom` | `Auto` | Overrides agent-level model preferences |
| **Auto-approve gates** | `ON / OFF / Timeout(N min)` | `OFF` | If ON: manual_gate nodes auto-approve. If Timeout: auto-approve after N minutes |
| **Confidence floor** | `0.0` – `1.0` | `0.70` | If agent self-reports confidence below floor: trigger re-run or delegate |

**Live indicators (read-only):**
- Turn counter: `turn N` (current turn across all active agents)
- Cost tracker: `$X.XX / $Y.YY` (spent / cap, red when > 80%)
- Runtime: `Xm Ys / limit` (elapsed / cap, red when > 80%)
- Status pill: `RUNNING` (blue pulse), `PAUSED` (yellow), `WAITING` (amber), `RETRYING` (orange)

**Model routing = Auto logic:**
- If task classification is "simple" (short input, no code, no multi-step): use local model
- If task classification is "complex" (long context, code, multi-step reasoning): use API model
- If local model is not loaded: use API model
- If over 50% of budget spent: downgrade to local model for remaining turns
- Classification is a lightweight prompt sent to the local model first (cheap, ~10 tokens)

### Parameters Persisted Per Template

When saving a workflow or template, these header parameters are stored in `workflow.default_config`:
```json
{
  "default_config": {
    "budget_cap_usd": 5.00,
    "runtime_limit_ms": 1800000,
    "max_turns_per_agent": 20,
    "model_routing": "auto",
    "auto_approve_gates": false,
    "confidence_floor": 0.70
  }
}
```
They are editable in the header before and during a run.

---

## 6. Node Catalog Curation

### Three-Tier Classification

**Tier 1 — Stable (default visible, usable in templates)**

| Node | Type | Idempotent? |
|---|---|---|
| Start | `core.start` | N/A |
| End / Output | `core.end` | N/A |
| Condition (IF) | `core.condition` | ✓ |
| Loop (bounded) | `core.loop` | ✓ |
| Merge | `core.merge` | ✓ |
| AI Agent Run | `ai.agent_run` | ✓ (same input = same run) |
| Spawn Delegate | `ai.spawn_delegate` | ✓ |
| LLM Query | `ai.llm_query` | ✓ |
| Model Provider | `model.local / .api / .auto` | N/A (config only) |
| HTTP Request (GET) | `http.request_get` | ✓ |
| HTTP Request (POST/PUT) | `http.request_write` | Idempotency-Key header |
| Read File | `util.read_file` | ✓ |
| Write File | `util.write_file` | ✓ (overwrite) |
| Bash (sandbox) | `util.bash` | ✗ (non-retryable by default) |
| Memory Read | `memory.read` | ✓ |
| Memory Write | `memory.write` | ✓ (upsert) |
| Set / Transform | `data.set` | ✓ |
| Filter | `data.filter` | ✓ |
| Manual Gate | `control.manual_gate` | N/A |

**Tier 2 — Beta (labeled "β", not in default templates)**

| Node | Notes |
|---|---|
| `notify.send_email` | Idempotency key required; shown with warning |
| `trigger.schedule` | Works but limited testing |
| `trigger.webhook` | Works but external reachability varies |
| `db.sqlite` | Local only; safe but not widely tested |
| `ai.tool_invoke` | Stable but complex config |

**Tier 3 — Hidden (not shown in palette, blocked at execution)**
- MySQL, MariaDB, MongoDB, MSSQL, Redis connectors
- `util.execute_workflow` (subworkflow — re-enable with recursion guard post-launch)
- Any node with no backend implementation in `execute_node`

### Single Source of Truth

The node registry lives in the **Rust backend**, served to the frontend via `cmd_flow_list_node_types`. The frontend never has a hardcoded list of supported nodes — it renders whatever the backend serves. This eliminates the UI/runtime mismatch.

```rust
pub struct NodeTypeDef {
    pub id: String,           // "ai.agent_run"
    pub label: String,        // "AI Agent"
    pub tier: NodeTier,       // Stable | Beta | Hidden
    pub category: String,     // "AI Components"
    pub idempotent: bool,
    pub side_effecting: bool,
    pub description: String,
    pub params_schema: Value, // JSON Schema for params editor
}
```

---

## 7. Durable Infrastructure

### Idempotency Contracts

Schema additions to `a2a_workflow_node_runs`:
```sql
ALTER TABLE a2a_workflow_node_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN attempt INTEGER DEFAULT 1;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN max_attempts INTEGER DEFAULT 3;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN backoff_ms INTEGER DEFAULT 2000;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN non_retryable INTEGER DEFAULT 0;
ALTER TABLE a2a_workflow_node_runs ADD COLUMN last_external_receipt TEXT;
```

Key = `sha256(run_id || node_id || attempt_number)`.

Before executing any side-effecting node: check if a completed `node_run` record exists for this key. If yes — return cached output. If no — execute and record.

### Checkpointing

```sql
CREATE TABLE IF NOT EXISTS flow_checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    turn INTEGER,
    session_snapshot TEXT,        -- JSON: agent Session for LLM nodes
    completed_node_outputs TEXT,  -- JSON: { node_id → output_json }
    created_at INTEGER NOT NULL
);
```

Written: after each completed node, every 5 agent turns, on pause.
Read: on resume — reconstruct which nodes are done, restore agent session.

### Cancellation Propagation

```
cmd_flow_run_cancel(run_id)
  → lookup CancellationToken for run_id in AgentOrchestrator
  → token.cancel()
  → all agents for this run receive cancel signal
  → active HTTP requests aborted
  → active bash processes receive SIGTERM (SIGKILL after 3s)
  → run status → "canceled"
  → emit a2a:workflow_changed { kind: "run_canceled" }
```

---

## 8. The Ralph Loop Template (Complete Specification)

### Code Fix Loop — Full Template Definition

This is the reference implementation. Every design decision is explained.

**What it does:**
Takes a bug description + working directory, autonomously analyzes the code, produces a fix plan, implements it, runs tests, and delivers a review report. No human intervention required (with auto-approve ON) or one approval gate (default).

**Visual layout:**

```
[model.api: Claude]  [model.api: GPT-4o]   [model.local]
       │                     │                    │
    agent_1               agent_2              agent_1
       │                     │                    │
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  START           │  │  ARCHITECT       │  │  PLAN GATE       │
│  ─────────────── │→ │  ─────────────── │→ │  ─────────────── │
│ task_description │  │ role: Architect  │  │ type: manual_gate│
│ working_dir      │  │ tools: read,ls,  │  │ timeout: 5min    │
│ test_command     │  │   grep,find      │  │ on_timeout:      │
└──────────────────┘  │ max_turns: 10    │  │   auto_approve   │
                      │ accept: schema   │  └──────────────────┘
                      └──────────────────┘            │
                                                       │
              [model.local]        [model.api: Claude Haiku]
                   │                        │
                agent_1                  agent_2
                   │                        │
        ┌──────────────────────────────────────────┐
        │           IMPLEMENTER                    │
        │ ─────────────────────────────────────── │
        │ role: Software Engineer                  │
        │ tools: read, write, edit, bash(sandbox)  │
        │ max_turns: 25                            │
        │ accept: test_pass (test_command) OR      │
        │         evaluator_grade (min_score: 7)   │
        │ retry: max 2, backoff 5s                 │
        └──────────────────────────────────────────┘
                            │
                [model.auto]
                     │
                  agent_1
                     │
        ┌──────────────────────────────────────────┐
        │           REVIEWER                       │
        │ ─────────────────────────────────────── │
        │ role: Code Reviewer                      │
        │ tools: read, grep, find                  │
        │ max_turns: 8                             │
        │ accept: schema_valid                     │
        │ output_schema: { score, issues, approved}│
        └──────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │ score >= 7?           │
               YES                     NO
                │                      │
        ┌───────────────┐    ┌──────────────────────┐
        │     END       │    │  REMEDIATION GATE    │
        │ ─────────────│    │ type: manual_gate    │
        │ output:       │    │ "Reviewer scored X.  │
        │   files,      │    │  Proceed anyway?"    │
        │   test_result,│    └──────────────────────┘
        │   review,     │              │
        │   cost,turns  │    ┌─────────┴──────────┐
        └───────────────┘   YES                   NO
                             │                    │
                      [back to IMPLEMENTER]     [END:failed]
                       with review feedback
```

### Template JSON

```json
{
  "id": "code-fix-ralph-loop",
  "name": "Code Fix Loop (Ralph)",
  "version": "1.0",
  "description": "Analyze a bug, implement a fix, run tests, and review. A complete autonomous coding loop.",
  "tags": ["coding", "stable", "ralph-loop"],
  "tier": "stable",

  "input_schema": {
    "type": "object",
    "required": ["task_description", "working_directory"],
    "properties": {
      "task_description": {
        "type": "string",
        "title": "Task",
        "description": "Describe the bug, feature, or change to make"
      },
      "working_directory": {
        "type": "string",
        "title": "Working Directory",
        "description": "Absolute path to the project root"
      },
      "test_command": {
        "type": "string",
        "title": "Test Command",
        "description": "Command to verify the fix (e.g. npm test). Leave blank to skip.",
        "default": ""
      }
    }
  },

  "default_config": {
    "budget_cap_usd": 5.00,
    "runtime_limit_ms": 1800000,
    "max_turns_per_agent": 20,
    "model_routing": "auto",
    "auto_approve_gates": false,
    "auto_approve_timeout_ms": 300000,
    "confidence_floor": 0.70
  },

  "nodes": [
    {
      "id": "start",
      "type": "core.start",
      "name": "Start",
      "position": { "x": 100, "y": 300 },
      "params": {
        "inputs": ["task_description", "working_directory", "test_command"]
      }
    },
    {
      "id": "model-claude",
      "type": "model.api",
      "name": "Claude (Architect)",
      "position": { "x": 340, "y": 140 },
      "params": {
        "model_config_ref": "auto_strongest_available",
        "fallback": "model.local"
      }
    },
    {
      "id": "architect",
      "type": "ai.agent_run",
      "name": "Architect",
      "position": { "x": 340, "y": 300 },
      "params": {
        "role": "Software Architect",
        "system_prompt": "You are a senior software architect. Analyze the codebase described in the working directory and produce a precise implementation plan for the given task. Output ONLY valid JSON matching the output schema. Do not implement anything yet.",
        "tools": ["read", "ls", "grep", "find"],
        "max_turns": 10,
        "acceptance_criteria": {
          "mode": "schema_valid",
          "min_turns": 2,
          "schema": {
            "type": "object",
            "required": ["objective", "files_to_modify", "steps", "test_strategy"],
            "properties": {
              "objective": { "type": "string" },
              "files_to_modify": { "type": "array", "items": { "type": "string" } },
              "steps": { "type": "array" },
              "test_strategy": { "type": "string" },
              "estimated_complexity": { "type": "string", "enum": ["low", "medium", "high"] }
            }
          }
        },
        "retry": { "max_attempts": 2, "backoff_ms": 3000 }
      }
    },
    {
      "id": "plan-gate",
      "type": "control.manual_gate",
      "name": "Plan Approval",
      "position": { "x": 580, "y": 300 },
      "params": {
        "prompt": "The architect has produced an implementation plan. Review and approve to proceed.",
        "show_input": true,
        "timeout_ms": 300000,
        "timeout_action": "auto_approve"
      }
    },
    {
      "id": "model-local",
      "type": "model.local",
      "name": "Local Model (Implementer)",
      "position": { "x": 820, "y": 140 },
      "params": {}
    },
    {
      "id": "model-evaluator",
      "type": "model.api",
      "name": "Claude Haiku (Evaluator)",
      "position": { "x": 1000, "y": 140 },
      "params": {
        "model_config_ref": "auto_fast_available",
        "fallback": "model.local"
      }
    },
    {
      "id": "implementer",
      "type": "ai.agent_run",
      "name": "Implementer",
      "position": { "x": 820, "y": 300 },
      "params": {
        "role": "Software Engineer",
        "system_prompt": "You are an expert software engineer. You have received an implementation plan from the architect. Execute it precisely. Make all the file changes described. When done, output: IMPLEMENTATION_COMPLETE",
        "tools": ["read", "write", "edit", "bash", "ls", "grep"],
        "bash_mode": "sandbox",
        "max_turns": 25,
        "acceptance_criteria": {
          "mode": "any_of",
          "min_turns": 3,
          "self_eval": {
            "done_signal": "IMPLEMENTATION_COMPLETE"
          },
          "test_pass": {
            "command": "${inputs.test_command}",
            "skip_if_empty": true,
            "success_exit_code": 0
          },
          "evaluator_grade": {
            "rubric": "Have all files in the plan been modified as described? Do the changes logically implement the objective? Score 0-10.",
            "min_score": 7,
            "uses_port": "agent_2"
          }
        },
        "retry": { "max_attempts": 2, "backoff_ms": 5000 },
        "delegation_config": {
          "enabled": false
        }
      }
    },
    {
      "id": "model-auto",
      "type": "model.auto",
      "name": "Auto (Reviewer)",
      "position": { "x": 1060, "y": 140 },
      "params": {}
    },
    {
      "id": "reviewer",
      "type": "ai.agent_run",
      "name": "Reviewer",
      "position": { "x": 1060, "y": 300 },
      "params": {
        "role": "Code Reviewer",
        "system_prompt": "You are an experienced code reviewer. Review all the changes made by the implementer. Check for: correctness, potential bugs, security issues, code style. Output ONLY valid JSON matching the output schema.",
        "tools": ["read", "grep", "find"],
        "max_turns": 8,
        "acceptance_criteria": {
          "mode": "schema_valid",
          "min_turns": 2,
          "schema": {
            "type": "object",
            "required": ["score", "issues", "approved", "summary"],
            "properties": {
              "score": { "type": "number", "minimum": 0, "maximum": 10 },
              "issues": { "type": "array" },
              "approved": { "type": "boolean" },
              "summary": { "type": "string" }
            }
          }
        }
      }
    },
    {
      "id": "quality-check",
      "type": "core.condition",
      "name": "Quality Gate",
      "position": { "x": 1300, "y": 300 },
      "params": {
        "condition": "${nodes.reviewer.output.score} >= 7",
        "true_label": "Approved",
        "false_label": "Needs Work"
      }
    },
    {
      "id": "remediation-gate",
      "type": "control.manual_gate",
      "name": "Override Review?",
      "position": { "x": 1300, "y": 480 },
      "params": {
        "prompt": "Reviewer scored ${nodes.reviewer.output.score}/10. Issues: ${nodes.reviewer.output.issues}. Override and proceed anyway?",
        "show_input": true,
        "timeout_ms": 120000,
        "timeout_action": "auto_reject"
      }
    },
    {
      "id": "end-success",
      "type": "core.end",
      "name": "Done",
      "position": { "x": 1540, "y": 300 },
      "params": {
        "output_fields": [
          "nodes.architect.output as plan",
          "nodes.implementer.output as implementation_summary",
          "nodes.reviewer.output as review",
          "meta.total_turns as total_turns",
          "meta.total_cost_usd as total_cost",
          "meta.duration_ms as duration_ms"
        ]
      }
    },
    {
      "id": "end-failed",
      "type": "core.end",
      "name": "Failed: Review Rejected",
      "position": { "x": 1540, "y": 480 },
      "params": {
        "status": "failed",
        "output_fields": ["nodes.reviewer.output as review"]
      }
    }
  ],

  "edges": [
    { "id": "e1", "source": "start", "source_output": "flow_out_1", "target": "architect", "target_input": "flow_in_1" },
    { "id": "e2", "source": "model-claude", "source_output": "agent_1", "target": "architect", "target_input": "agent_1" },
    { "id": "e3", "source": "architect", "source_output": "flow_out_1", "target": "plan-gate", "target_input": "flow_in_1" },
    { "id": "e4", "source": "plan-gate", "source_output": "flow_out_1", "target": "implementer", "target_input": "flow_in_1" },
    { "id": "e5", "source": "model-local", "source_output": "agent_1", "target": "implementer", "target_input": "agent_1" },
    { "id": "e6", "source": "model-evaluator", "source_output": "agent_1", "target": "implementer", "target_input": "agent_2" },
    { "id": "e7", "source": "implementer", "source_output": "flow_out_1", "target": "reviewer", "target_input": "flow_in_1" },
    { "id": "e8", "source": "model-auto", "source_output": "agent_1", "target": "reviewer", "target_input": "agent_1" },
    { "id": "e9", "source": "reviewer", "source_output": "flow_out_1", "target": "quality-check", "target_input": "flow_in_1" },
    { "id": "e10", "source": "quality-check", "source_output": "flow_out_1", "target": "end-success", "target_input": "flow_in_1" },
    { "id": "e11", "source": "quality-check", "source_output": "flow_out_2", "target": "remediation-gate", "target_input": "flow_in_1" },
    { "id": "e12", "source": "remediation-gate", "source_output": "flow_out_1", "target": "end-success", "target_input": "flow_in_2" },
    { "id": "e13", "source": "remediation-gate", "source_output": "flow_out_2", "target": "end-failed", "target_input": "flow_in_1" }
  ]
}
```

---

## 9. Observable Flow Panel

### Node Visual States

| State | Visual |
|---|---|
| `idle` | Gray border, dim text |
| `running` | Blue border (animated glow pulse), spinner in corner |
| `waiting_user` | Amber border, pause icon |
| `retrying` | Orange border, retry badge `↺ 2/3` |
| `succeeded` | Green border, checkmark, dim after 3s |
| `failed` | Red border, X icon, stays red |
| `skipped` | Gray with dashed border |

**Model routing indicator on running nodes:**
Small pill in top-right corner of node: `claude` / `local` / `gpt4` — shows which model is actively running.

**Turn counter on agent nodes (running):**
`turn 8 / 20` — visible below the node name.

### Live Streaming in Node Inspector

When an agent node is running, clicking it opens the inspector showing:
- **Left panel:** Input received by this node
- **Center panel:** Live streaming text from the agent (TextDelta events), current tool call highlighted
- **Right panel:** Not yet available (shows "running..." animation)

Events streamed via `a2a:run_trace_chunk` with sub-event type:

```json
{
  "run_id": "...",
  "node_id": "implementer",
  "sub_event": "agent_text_delta | agent_tool_start | agent_tool_result | agent_thinking",
  "payload": { "delta": "...", "tool_name": "...", "turn": 8 }
}
```

### Run Progress Header (live)

```
⏵ "Code Fix Loop" — RUNNING  │  turn 14  ·  $0.12 / $5.00  ·  6m 04s / 30:00  │  [⏸] [⏹]
```

Cost tracker updates after each LLM call using `usage.input_tokens * price_per_token` from the connected model's config in the API panel.

### Run History Sidebar

Below the canvas (collapsible):
- List of all runs for this workflow: status icon, start time, duration, cost
- Click row → load run trace
- Run trace: timeline of node events with timestamps
- Export button → downloads trace as JSON

---

## 10. Security and Boundaries

### Filesystem Scope Enforcement

`util.read_file`, `util.write_file`, `util.bash`:
- Default: restricted to `${inputs.working_directory}` and its children
- Any path outside this scope: blocked with error `PATH_OUTSIDE_WORKSPACE`
- Elevated mode: requires `elevated: true` in node params + user confirmation dialog at run start
- All file operations logged in node-run record

### Bash Sandbox

`util.bash` in sandbox mode (default):
- Allowed: commands that read/write within workspace, run interpreters (node, python, cargo, etc.)
- Blocked: `rm -rf /`, `curl | bash`, `sudo`, process spawning outside workspace
- Implementation: pre-flight regex check on command string + working directory enforcement
- Non-retryable by default: if bash fails, it does not auto-retry (user can override)

### Budget Enforcement

Cost is tracked per LLM call. After each call:
```
cumulative_cost += (input_tokens * input_price + output_tokens * output_price)
if cumulative_cost >= budget_cap:
  emit "a2a:budget_exceeded"
  transition run to budget_exceeded state
  if on_budget_exceeded == "pause": → paused (user can increase budget and resume)
  if on_budget_exceeded == "cancel": → canceled
```

Local model calls cost $0 and do not contribute to budget.

---

## 11. Master Todo List

### BLOCKING — Must complete before launch

**B1 — Node catalog single source of truth**
- [ ] Define `NodeTypeDef` struct in Rust with `tier` field
- [ ] Implement `cmd_flow_list_node_types` command
- [ ] Frontend fetches node palette from backend on load (replaces hardcoded list)
- [ ] Mark all Tier 3 nodes hidden; mark Tier 2 with β label
- [ ] Backend blocks execution of Tier 3 nodes: return `NODE_TYPE_UNSUPPORTED` error

**B2 — Unsupported node detection before run**
- [ ] `cmd_flow_run_start` scans graph for Tier 3 nodes before beginning
- [ ] Returns structured error: `{ blocking_nodes: [{ id, type, reason }] }`
- [ ] Frontend shows pre-run validation dialog with specific node names

**B3 — Run cancellation with full propagation**
- [ ] `CancellationToken` per active run stored in `AgentOrchestrator` map
- [ ] `cmd_flow_run_cancel(run_id)` fires token → propagates to all active node tasks
- [ ] Active bash subprocess: SIGTERM → 3s → SIGKILL
- [ ] Active HTTP request: `reqwest` client abort
- [ ] Active agent turns: watch channel cancel
- [ ] Status → `canceled`; emit event
- [ ] Wire [Cancel] button in header run bar

**B4 — Idempotency schema additions**
- [ ] DB migration: add columns to `a2a_workflow_node_runs`
- [ ] Generate idempotency key before each node execution
- [ ] For HTTP POST/PUT/DELETE: add `Idempotency-Key` header
- [ ] For email: skip if same key already has `completed` record
- [ ] For bash: set `non_retryable = true` by default
- [ ] On retry: check completed record → return cached output if found

**B5 — Filesystem boundary enforcement**
- [ ] `util.read_file` and `util.write_file` validate path is within workspace root
- [ ] `util.bash` defaults to sandbox mode with workspace as working dir
- [ ] Elevated mode: `elevated: true` param + confirmation dialog on run start
- [ ] All file ops logged in node-run record

**B6 — Startup health check + capability visibility**
- [ ] On startup: check model endpoint, STT, TTS, writable dirs
- [ ] Emit `startup:health` event with structured results
- [ ] Voice buttons disabled with tooltip if unavailable
- [ ] Show health panel in Help/Settings

---

### HIGH PRIORITY — Complete this week

**H1 — Full loop state machine**
- [ ] Update `status` enum in `a2a_workflow_runs`
- [ ] Implement state transitions in `a2a/runtime.rs`
- [ ] `cmd_flow_run_pause` + `cmd_flow_run_resume`
- [ ] State badge in flow header
- [ ] [Pause] / [Resume] / [Cancel] buttons

**H2 — Header run controls bar**
- [ ] Add `default_config` fields to workflow schema (budget, runtime, turns, routing, etc.)
- [ ] Run controls bar replaces toolbar when run is active
- [ ] Live cost, runtime, turn counter
- [ ] Budget cap enforced in runtime: emit event + pause/cancel on exceed
- [ ] Runtime limit enforced: transition to `timed_out` on exceed

**H3 — Connect agent crate to flow LLM node execution**
- [ ] `ai.agent_run` node executor calls `Agent::run_collect` from agent crate
- [ ] Stream `Event` variants as `a2a:run_trace_chunk` sub-events
- [ ] `ai.llm_query` node calls `run_single_turn` (single turn, not full loop)
- [ ] Cancellation from run cancel → agent cancel channel

**H4 — Model routing via top ports**
- [ ] `model.*` node types (local, api, auto) in node palette + backend
- [ ] `agent_1` port wires → primary model for that node's agent
- [ ] `agent_2` port wires → evaluator model
- [ ] `agent_3` port wires → delegate model
- [ ] If no model connected to `agent_1`: use app default
- [ ] Context menu "Add API" → creates `model.api` node connected to `agent_1`
- [ ] Model node renders: name, provider color, cost indicator, availability dot

**H5 — Acceptance criteria execution**
- [ ] Parse `acceptance_criteria` from node params
- [ ] `self_eval`: inject evaluation prompt after each turn; check for done signal
- [ ] `schema_valid`: validate output JSON against schema; fail with diff if invalid
- [ ] `test_pass`: run bash command; success exit code = accept
- [ ] `evaluator_grade`: single-turn call to `agent_2` model with rubric; grade output; re-run on fail
- [ ] `manual_gate`: pause run, emit event, wait for `cmd_flow_gate_approve(run_id, gate_id, decision)`

**H6 — Durable checkpointing**
- [ ] Create `flow_checkpoints` table
- [ ] Write checkpoint after each completed node
- [ ] Write checkpoint every 5 agent turns (agent session snapshot)
- [ ] Write checkpoint on pause
- [ ] Resume: load checkpoint, reconstruct state, skip completed nodes

**H7 — Live node visualization**
- [ ] Per-node state visual (color/border/icon) driven by `flowExecutionStore`
- [ ] Running agent nodes show live text stream in inspector
- [ ] Turn counter on running agent nodes
- [ ] Model routing indicator pill on running nodes
- [ ] Retry badge on retrying nodes
- [ ] Cost badge on completed nodes (for API model calls)

**H8 — Architect/Manager panel**
- [ ] Collapsible floating panel, bottom-right, 3 tabs
- [ ] Analyze: serialize flow JSON → architect agent call → plain-English description
- [ ] Validate: same agent call → structured error/warning list; errors block run start
- [ ] Suggest: improvement suggestions with "Apply" buttons
- [ ] Auto-validate on run start (blocking errors prevent execution)

**H9 — Code Fix Loop template + gallery**
- [ ] Full JSON template as specified in Section 8 above
- [ ] Template stored in app resources, served by `cmd_flow_list_templates`
- [ ] Template gallery UI: grid layout, preview description, "Use template" button
- [ ] Input form rendered from template `input_schema` before run starts
- [ ] Business Analysis Loop template (same structure, different agents/prompts)

**H10 — Run history + trace viewer**
- [ ] Run history list in sidebar or panel footer
- [ ] Trace viewer: timeline of node events with timestamps
- [ ] Per-node events: start, tool calls, text output, end, errors, cost
- [ ] Export trace as JSON

---

### MEDIUM PRIORITY — Post-launch week 1

**M1 — Autonomous delegation (`ai.spawn_delegate` node + `delegation_config`)**
- [ ] `ai.spawn_delegate` node type with config schema
- [ ] Parse `<delegate>` block from agent output
- [ ] Route task to `agent_3` connected model
- [ ] Return result as tool result in agent's next turn
- [ ] `spawn_delegate` also available as tool in primary chat agent

**M2 — Model auto-routing intelligence**
- [ ] Complexity classifier: lightweight pre-flight prompt to local model
- [ ] Route to primary (API) if complexity > threshold
- [ ] Route to local if under budget pressure (> 50% spent)
- [ ] Budget-aware routing: downgrade to local when nearing cap

**M3 — Additional templates**
- [ ] Due Diligence Loop
- [ ] Daily Assistant Loop
- [ ] Custom (blank with scaffold comments)

**M4 — specta IPC type generation**
- [ ] All new flow-related Rust types annotated with `#[derive(specta::Type)]`
- [ ] Generated `src/bindings.ts` at build time
- [ ] Frontend flow code imports generated types

**M5 — Diagnostics export**
- [ ] One-click export: recent logs + flow run trace + system info
- [ ] Strip API keys + message content
- [ ] Output as .zip

**M6 — Windows/macOS platform fixes**
- [ ] Windows PID safety + console window + path separator audit
- [ ] macOS Gatekeeper decision + documentation
- [ ] Startup progress screen

---

### DEFERRED — Post-launch

- Subworkflow node (`util.execute_workflow`) with recursion guard
- Broad connector library (MySQL, Mongo, Redis)
- Template marketplace
- Multi-worker parallel run scale-out
- Voice inside agent nodes
- Vector memory for loop context retrieval
- Python-free TTS (tract-onnx Kokoro)

---

## 12. Definition of Done

**The Flow system is launch-ready when all of the following are true:**

1. **Code Fix Loop runs end-to-end on Linux, macOS, and Windows** without manual intervention (auto-approve ON)
2. **Tier 3 nodes are hidden** and blocked — no silent failures
3. **Cancel propagates cleanly** — active agents stop within 5 seconds of cancel
4. **Side-effecting nodes are idempotent or non-retryable** — no duplicate side effects on retry
5. **Budget and runtime caps are enforced** — no runaway loops possible
6. **Live node visualization is working** — user watches progress node-by-node
7. **Model routing via top ports is functional** — connecting a model.api node changes which model runs
8. **Architect panel validate tab** catches unsupported nodes and schema mismatches before run start
9. **Checkpointing enables pause/resume** — a paused loop resumes from the checkpoint node
10. **Trace export works** — a failed run produces an exportable trace with enough detail to diagnose the failure
