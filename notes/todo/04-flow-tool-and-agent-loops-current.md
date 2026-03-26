# Flow Tool and Agent Loops — Current State

---

## What Exists Today

### 1. The A2A Workflow Engine (Rust)

**Location:** `src-tauri/src/commands/a2a_workflow.rs`, `src-tauri/src/a2a/`

The workflow engine provides:

- **Workflow CRUD**: Create, read, update, delete workflow definitions (DAG stored in `a2a.db`)
- **WorkflowRun lifecycle**: Create a run, update status, store trace events
- **Concurrency permits**: Global (4 max) and per-workflow (2 max) limits via `AtomicUsize` + `Mutex<HashMap>`
- **Event emission**: `a2a:workflow_changed` and `a2a:run_trace_chunk` for UI updates

**Schema (inferred from commands):**
```
Workflow {
  id: String (UUID)
  name: String
  description: String
  nodes: JSON (array of WorkflowNode)
  edges: JSON (array of {from, to})
  created_at: timestamp
}

WorkflowRun {
  id: String (UUID)
  workflow_id: String
  status: "running" | "completed" | "failed" | "cancelled"
  input: JSON
  output: JSON
  trace: JSON (array of trace events)
  created_at: timestamp
}
```

**What it does NOT do:**
- Does not actually execute agent turns or make LLM calls
- Does not resolve node dependencies (topological sort)
- Does not pass data between nodes
- Does not resume interrupted runs
- Does not checkpoint state during execution

### 2. The Agent Crate (Rust)

**Location:** `agent/src/`

Provides a standalone agentic loop:
- `Agent` struct with `run_collect()` method
- Provider abstraction for OpenAI-compatible endpoints
- 10 built-in tools (read, write, edit, ls, mkdir, bash, grep, find, move, chmod)
- Session with compaction support
- Event stream: `AgentStart`, `TurnStart`, `TurnEnd`, `ToolCall`, `ToolResult`, `AgentEnd`

**Current usage:**
- Primarily used by the `arx-rs` CLI binary (standalone command-line agent)
- The Tauri app has its own chat streaming path in `commands/chat.rs` that does NOT use the agent crate
- The agent crate and the Tauri chat path are effectively parallel implementations

**Gap:** The agent crate exists as a standalone library but is not wired into the Tauri app as the execution engine. This is the primary integration point that needs to be built.

### 3. The Flow Tool (Frontend)

**Location:** `src/tools/flow/`

The frontend tool manifest for Flow exists, but detailed implementation of `FlowPanel` would need to be inspected. Based on the manifest system:
- Has a panel component for visual workflow building
- Can invoke `cmd_a2a_workflow_*` commands
- Likely shows a node graph editor for defining workflows

**Gap:** The frontend can define workflows visually, but execution is shallow — a workflow "run" is created in the database, but actual multi-turn agent execution within each node is not happening.

---

## Gap Analysis: What's Missing for True REPL Loops

A "true REPL loop" as described means:

1. **Long-duration**: Runs for many turns (10–100+) without manual re-triggering
2. **Organized**: Multiple specialized agents (architect, coder, reviewer) with clear roles
3. **Structured data flow**: Outputs of one agent become inputs to the next
4. **Durable**: Survives app restart; can be paused/resumed
5. **Observable**: Real-time progress visible in the UI
6. **Delegatable**: Primary agent can spawn and manage sub-agents

### Current State vs. Required State

| Capability | Current State | Required |
|---|---|---|
| Multi-turn single agent | ✓ (`run_collect`) | ✓ |
| Streaming events to UI | ✓ (chat path) | ✓ |
| Parallel agent execution | ✗ | ✓ |
| Agent spawning agents | ✗ | ✓ |
| Structured data handoff between agents | ✗ | ✓ |
| Durable run state (survives restart) | ✗ | ✓ |
| Run pause/resume | ✗ | ✓ |
| Flow templates | ✗ | ✓ |
| Progress observable in UI | Partial (trace events) | ✓ |
| Tool: spawn_agent | ✗ | ✓ |
| Tool: wait_for_agent | ✗ | ✓ |
| Tool: read_agent_output | ✗ | ✓ |

---

## The "Ralph Loop" Concept

The term comes from the idea of a **Recursive Agent Learning and Planning (RALPH)** loop — a primary agent that:

1. Receives a high-level task
2. Decomposes it into sub-tasks
3. Spawns specialized agents for each sub-task
4. Collects results and synthesizes
5. Iterates if results are insufficient
6. Delivers a final output

This is essentially a **supervisor-worker** multi-agent pattern.

### How This Maps to the Current Codebase

```
Primary Agent (the user's main chat)
│  Tool: flow_create_loop(template, task_description)
│  Tool: flow_spawn_agent(agent_config, task)
│  Tool: flow_check_status(agent_id)
│  Tool: flow_get_result(agent_id)
│
├── Sub-Agent 1: Architect
│   Agent (from agent crate) with specialized system prompt
│   Tools: read, write, bash, grep
│   Runs for N turns on a specific sub-task
│   Outputs: structured JSON result
│
├── Sub-Agent 2: Implementer
│   Receives Architect output as input
│   Runs for M turns implementing the plan
│   Outputs: list of modified files + summary
│
└── Sub-Agent 3: Reviewer
    Receives Implementer output
    Reviews changes, outputs: pass/fail + comments
```

The primary agent drives the loop by:
1. Calling `flow_spawn_agent` → creates a new agent run in `a2a.db`
2. Calling `flow_check_status` periodically or being notified via event
3. Calling `flow_get_result` when the agent completes
4. Making decisions based on results (retry, proceed, escalate)

---

## What the Flow Tool Needs to Become

### Template System

Templates are pre-configured workflow patterns that the primary agent (or user) can instantiate:

```
templates/
├── coding-loop.json      (Architect → Implementer → Tester → Reviewer)
├── research-loop.json    (Searcher → Analyzer → Writer → Editor)
├── diligence-loop.json   (DataCollector → Analyst → RiskScorer → Reporter)
├── personal-assistant.json (Planner → Executor → Tracker)
└── custom.json           (Empty template for the primary agent to fill in)
```

Each template defines:
- Node types (agent configs, tools, system prompts)
- Edge connections (data flow)
- Input/output schemas
- Max turns per node
- Retry policies

### Agent Delegation Tool

A new tool in the agent crate: `spawn_agent`

```rust
// pseudo-code
struct SpawnAgentArgs {
    agent_config: AgentConfig,    // model, system_prompt, tools, max_turns
    task: String,                  // the task for the sub-agent
    wait: bool,                    // synchronous or fire-and-forget
    output_schema: Option<Schema>, // expected output format
}

struct SpawnAgentResult {
    agent_id: String,
    status: AgentStatus,
    output: Option<Value>,         // if wait=true and completed
}
```

This tool, available to the primary agent, is what enables true REPL loops.

---

## The Connection Layer: Wiring Agent Crate into Tauri

Currently:
```
Tauri frontend → invoke(cmd_chat_stream) → commands/chat.rs → direct HTTP to provider
```

What it should be (for agent-powered interactions):
```
Tauri frontend → invoke(cmd_agent_run) → commands/agent.rs → agent crate → provider
                                                           → A2A workflow engine
                                                           → event stream to frontend
```

The `agent crate` should become the execution engine for ALL agent interactions in the Tauri app:
- Primary chat (with streaming to UI)
- Sub-agent runs (spawned by primary agent via tool)
- Workflow node execution (spawned by workflow engine)

This unification would eliminate the dual path (agent crate vs. direct chat path) and make all features benefit from the same improvements (compaction, retry, event streaming, cancellation).
