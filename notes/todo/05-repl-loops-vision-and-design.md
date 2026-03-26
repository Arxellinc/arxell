# REPL Loops — Vision and Technical Design

---

## 1. The Mental Model

A REPL Loop in ARX is a **named, durable, multi-agent process** that:

- Has a clearly defined **goal** (set by the user or primary agent)
- Runs for as long as it takes — turns, hours, even days
- Is made of **stages** where each stage is an **agent with a role**
- Can **self-direct** — the primary agent decides which stage to run next
- Can be **paused, resumed, observed** at any point
- Produces structured **artifacts** (files, reports, code) not just text

The user thinks about it like kicking off a project:
> "Run a due diligence loop on company X. Use the research template."

And then watches it progress, intervenes when needed, and receives the final package.

---

## 2. Architecture for REPL Loops

### 2.1 The Execution Stack

```
┌───────────────────────────────────────────────────────┐
│  Primary Agent (UI-connected, streaming to chat)      │
│                                                       │
│  Has access to "loop tools":                          │
│  - flow.create(template, goal)                        │
│  - flow.spawn_agent(config, task)                     │
│  - flow.get_result(agent_id)                          │
│  - flow.list_runs()                                   │
│  - flow.wait(agent_id)                                │
└──────────────────────┬────────────────────────────────┘
                       │
           spawns/manages
                       │
┌──────────────────────▼────────────────────────────────┐
│  Agent Worker Pool (Rust tokio task pool)             │
│                                                       │
│  Each worker:                                         │
│  - Is a full Agent instance (agent crate)             │
│  - Has its own session, tools, system prompt          │
│  - Writes progress to a2a.db                          │
│  - Emits events via Tauri app handle                  │
│  - Is cancellable via watch channel                   │
└──────────────────────┬────────────────────────────────┘
                       │
              accesses
                       │
┌──────────────────────▼────────────────────────────────┐
│  Durable State Layer (SQLite)                         │
│                                                       │
│  - agent_runs table: status, input, output, trace     │
│  - agent_artifacts: structured outputs per run        │
│  - flow_sessions: parent-child relationships          │
└───────────────────────────────────────────────────────┘
```

### 2.2 New Database Tables

For durable REPL loop support, the `a2a.db` needs:

```sql
-- Agent run instances (one per agent invocation)
CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    parent_run_id TEXT,          -- parent agent that spawned this
    flow_session_id TEXT,        -- which REPL session this belongs to
    role TEXT,                   -- "architect", "coder", "reviewer", etc.
    status TEXT,                 -- "pending" | "running" | "paused" | "completed" | "failed"
    model TEXT,
    system_prompt TEXT,
    task TEXT,                   -- the input task/query
    output TEXT,                 -- final output (JSON or text)
    turn_count INTEGER DEFAULT 0,
    max_turns INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    completed_at INTEGER
);

-- Structured artifacts produced by agents
CREATE TABLE agent_artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES agent_runs(id),
    artifact_type TEXT,          -- "file", "report", "code", "data"
    name TEXT,
    path TEXT,                   -- filesystem path if a file
    content TEXT,                -- inline content if small
    mime_type TEXT,
    created_at INTEGER
);

-- Flow sessions (top-level REPL loop instances)
CREATE TABLE flow_sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    template TEXT,               -- which template was used
    goal TEXT,
    status TEXT,
    root_run_id TEXT,            -- the primary agent's run
    created_at INTEGER,
    updated_at INTEGER
);

-- Checkpoints for pause/resume
CREATE TABLE flow_checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES flow_sessions(id),
    run_id TEXT REFERENCES agent_runs(id),
    turn INTEGER,
    session_snapshot TEXT,       -- serialized Session JSON
    created_at INTEGER
);
```

### 2.3 New Tauri Commands

```rust
// Create and start a flow session
cmd_flow_create(template: String, goal: String) -> FlowSession

// Spawn a sub-agent from within a flow session
cmd_flow_spawn_agent(
    session_id: String,
    parent_run_id: String,
    config: AgentRunConfig,
    task: String,
) -> AgentRun

// Get current status and output of a run
cmd_flow_get_run(run_id: String) -> AgentRun

// List runs in a session (tree view)
cmd_flow_list_runs(session_id: String) -> Vec<AgentRun>

// Pause a running agent
cmd_flow_pause_run(run_id: String) -> Result

// Resume a paused agent
cmd_flow_resume_run(run_id: String) -> Result

// Cancel an agent
cmd_flow_cancel_run(run_id: String) -> Result

// List all active flow sessions
cmd_flow_list_sessions() -> Vec<FlowSession>
```

### 2.4 New Agent Tools (in agent crate)

These tools are available to any agent that runs in ARX (primary or sub-agent):

```rust
// Spawn a sub-agent and optionally wait for result
Tool: spawn_agent {
    role: String,              // descriptive name for the sub-agent
    system_prompt: String,     // specialization
    task: String,              // what to do
    tools: Vec<String>,        // which tool names to give the sub-agent
    max_turns: i64,
    wait: bool,                // block until complete?
    model: Option<String>,     // override model
}
// Returns: { agent_id, status, output? }

// Check status of a spawned agent
Tool: agent_status {
    agent_id: String,
}
// Returns: { status, turn_count, output? }

// Read final output of a completed agent
Tool: agent_result {
    agent_id: String,
}
// Returns: { output, artifacts: [{ name, path }] }

// Write a structured artifact from the current run
Tool: write_artifact {
    name: String,
    artifact_type: String,
    content: String,
    path: Option<String>,
}
```

---

## 3. Flow Templates

Templates are JSON configuration files that describe a REPL loop pattern. They are shipped with ARX and can also be created by agents.

### Example: Coding Loop Template

```json
{
  "id": "coding-loop",
  "name": "Coding Loop",
  "description": "Architect a feature, implement it, test it, and review it",
  "stages": [
    {
      "id": "architect",
      "role": "Software Architect",
      "system_prompt": "You are a senior software architect. Analyze the task and produce a detailed implementation plan as structured JSON. Include: files to create/modify, function signatures, data structures, and step-by-step implementation guide.",
      "tools": ["read", "ls", "grep", "find"],
      "max_turns": 10,
      "output_schema": {
        "type": "object",
        "properties": {
          "plan": { "type": "array" },
          "files_to_modify": { "type": "array" },
          "dependencies": { "type": "array" }
        }
      }
    },
    {
      "id": "implementer",
      "role": "Software Engineer",
      "system_prompt": "You are an expert software engineer. You have received an implementation plan. Execute it precisely, creating and modifying files as specified.",
      "tools": ["read", "write", "edit", "bash", "ls", "grep"],
      "max_turns": 30,
      "input_from": "architect"
    },
    {
      "id": "tester",
      "role": "QA Engineer",
      "system_prompt": "You are a thorough QA engineer. Run the test suite, identify failures, and fix them.",
      "tools": ["read", "write", "edit", "bash"],
      "max_turns": 15,
      "input_from": "implementer"
    },
    {
      "id": "reviewer",
      "role": "Code Reviewer",
      "system_prompt": "You are an experienced code reviewer. Review the changes for correctness, security, and style. Produce a structured review report.",
      "tools": ["read", "grep", "find"],
      "max_turns": 10,
      "input_from": "tester"
    }
  ],
  "orchestration": "sequential"
}
```

### Other Templates to Ship

| Template | Stages | Orchestration |
|---|---|---|
| **Research Loop** | Web searcher → Synthesizer → Writer → Editor | Sequential |
| **Due Diligence** | Data collector → Financial analyst → Risk scorer → Report writer | Sequential |
| **Personal Assistant** | Task parser → Calendar checker → Executor → Notifier | Sequential |
| **Debate** | Advocate A → Advocate B → Judge | Turn-based |
| **Custom** | User-defined | Flexible |

---

## 4. The Primary Agent's Role

The primary agent (the one the user talks to in chat) becomes the **orchestrator**. It has access to the flow tools and uses them to delegate.

Example interaction:

```
User: "I need to add a payment processing feature to this project. Use the coding loop."

Primary Agent:
  I'll set up a coding loop for the payment feature.

  [tool: flow.create(template="coding-loop", goal="Add Stripe payment processing")]
  → Session created: flow_ABC

  [tool: spawn_agent(role="architect", task="Plan the Stripe integration", wait=true)]
  → Running architect agent... (10 turns)
  → Architect output: { plan: [...], files: ["src/payment.ts", "src/api/checkout.ts"], ... }

  [tool: spawn_agent(role="implementer", task=architect_output, wait=false)]
  → Implementer started (async): agent_XYZ

  The implementation is running in the background. You can watch progress
  in the Flow panel. I'll notify you when it's ready for review.
```

The primary agent doesn't need to know the template details — it just describes the goal, and the template handles stage orchestration.

---

## 5. Expected Success by Task Type

### High Confidence (80%+)
- **Coding tasks**: Well-defined scope, objective tests, structured outputs → strong
- **Research/summarization**: LLMs excel at summarizing and structuring research → strong
- **Report generation**: Structured output from multiple data sources → strong

### Medium Confidence (50–80%)
- **Due diligence**: Success depends heavily on data access (web search, document parsing)
- **Code review loops**: Review quality depends on model capability; may need GPT-4 class
- **Personal assistant**: Task success depends on API access (calendar, email) — tool gap

### Lower Confidence (30–50%)
- **Open-ended automation**: "Do whatever it takes to..." — hard to bound and verify
- **Multi-step business decisions**: Require judgment that models inconsistently provide
- **Long creative work**: Stories, long-form writing tend to drift over many turns

### Key Factors That Affect Success

1. **Model quality**: A 7B local model will struggle with 20+ turn planning tasks; routing complex loops to API (Claude/GPT-4) improves success significantly
2. **Tool availability**: Without web search, research loops are limited to local files
3. **Context compaction**: Long loops hit context limits; the compaction quality determines if the agent "remembers" what it did
4. **Clear stopping criteria**: Loops need to know when they're done; templates should define exit conditions
5. **Structured outputs**: Agents that write JSON artifacts preserve information better than those producing narrative only

---

## 6. Implementation Phases

### Phase 1: Wire Agent Crate into Tauri (Foundation)
- Create `commands/agent.rs` that uses the `agent` crate
- Stream events from `Agent::run_collect` to the frontend
- This replaces the direct HTTP streaming in `commands/chat.rs`
- **Estimated effort:** 2–3 days (one developer)
- **Unblocks:** All subsequent phases

### Phase 2: Sub-Agent Spawn Tool (Core Feature)
- Add `spawn_agent` tool to agent crate
- Connect to `cmd_flow_spawn_agent` Tauri command
- Manage agent worker tasks in tokio
- **Estimated effort:** 2–3 days
- **Unblocks:** REPL loops

### Phase 3: Durable State + Pause/Resume
- Add `flow_sessions`, `agent_runs`, `agent_artifacts`, `flow_checkpoints` tables
- Implement checkpoint save on pause, restore on resume
- **Estimated effort:** 2 days
- **Unblocks:** Long-running loops that survive restarts

### Phase 4: Flow Templates
- JSON template format + loader
- 3–5 built-in templates shipped with app
- Template selection UI in FlowPanel
- **Estimated effort:** 1–2 days
- **Unblocks:** Easy onboarding to REPL loops

### Phase 5: UI for Loop Observability
- FlowPanel shows live agent tree (session → runs → turns)
- Progress indicators per node
- Artifact browser
- **Estimated effort:** 2–3 days
- **Unblocks:** User confidence in loop execution
