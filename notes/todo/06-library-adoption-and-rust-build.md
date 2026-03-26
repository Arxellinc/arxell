# Library Adoption and What to Build in Rust

---

## 1. The ralph-orchestrator Question

**Repository:** `https://github.com/mikeyobrien/ralph-orchestrator`

ralph-orchestrator is a Rust library/binary for multi-agent orchestration. Its core ideas:

- Agents are tasks with a system prompt, tools, and a goal
- An orchestrator manages a pool of agents, routing tasks and collecting results
- Communication between agents is via message passing (channels)
- Each agent runs in its own async task

### Should We Use It Directly?

**Assessment: Borrow ideas, not the library itself.**

Reasons:
1. ARX already has a well-structured `agent` crate that covers similar ground — adding ralph-orchestrator creates a dependency on an external crate with its own schema, configuration, and update cadence
2. The agent crate's `Agent` struct and `Provider` trait are already the right abstractions; what's missing is the _orchestration layer on top_
3. ralph-orchestrator's inter-agent communication model (message passing) is similar to what we need, but the specifics of how agents share context/artifacts would need to be adapted to ARX's existing session/DB model
4. Community contributions are more likely if the codebase uses its own clean abstractions rather than a less-known dependency

**What to borrow:**
- The **supervisor-worker pattern**: primary agent issues tasks, worker agents execute them, supervisor collects results
- The idea of **bounded concurrency** with a semaphore/permit system (already partially in place in `a2a_workflow.rs`)
- **Typed inter-agent messages**: define a small `AgentMessage` enum for what agents can pass to each other (task, result, artifact_ref, error)

---

## 2. Libraries Worth Adopting

### 2.1 `specta` + `tauri-specta` (STRONGLY RECOMMENDED)

**What it does:** Code-generates TypeScript types from Rust structs/enums. Every Rust type that crosses the Tauri IPC boundary can be automatically typed in TypeScript.

**Why:** Currently, Tauri events and command return types are untyped on the TypeScript side. Any mismatch is a runtime bug. With specta, the types are generated at build time.

```toml
[dependencies]
specta = "2"
tauri-specta = { version = "2", features = ["derive", "typescript"] }
```

**Integration:** Add `#[derive(specta::Type)]` to structs, run generation in `build.rs`, output a `bindings.ts` file that TypeScript imports.

**Effort:** 1–2 days to annotate all Tauri command types and event payloads.
**Impact:** Eliminates an entire class of frontend bugs; makes community contributions much safer.

---

### 2.2 `sqlx` (CONSIDER, not urgent)

**What it does:** Async, compile-time-checked SQL queries for Rust.

**Why currently using `rusqlite`:** Synchronous, battle-tested, simple to use. The current `Mutex<Connection>` pattern works.

**Why to consider `sqlx`:**
- Async queries would eliminate the need to spawn blocking tasks for DB operations
- Compile-time SQL verification catches query errors at build time
- Connection pool support (`SqlitePool`) would replace the `Mutex<Connection>` bottleneck

**Honest assessment:** This is a significant migration. `rusqlite` works fine for current scale. **Defer this.** Instead, enable WAL mode now (one line) and revisit connection pooling if A2A workflow concurrency becomes a bottleneck.

---

### 2.3 `tokio-util` (Already a transitive dep — use it more)

The `CancellationToken` from `tokio-util` is cleaner than the `watch::Receiver<bool>` pattern currently used for cancellation. Both work; `CancellationToken` is more ergonomic and supports cancellation trees (parent cancels all children).

```rust
// Current pattern (works but is manual):
let (tx, rx) = tokio::sync::watch::channel(false);
// ... pass rx to agent, tx.send(true) to cancel

// Better with CancellationToken:
let token = CancellationToken::new();
let child_token = token.child_token(); // cancels when parent cancels
// token.cancel() cancels everything in the tree
```

For REPL loops where a primary agent cancels a tree of sub-agents, `CancellationToken` with child tokens is the right primitive.

**Effort:** Low — it's a drop-in replacement in the agent crate.

---

### 2.4 `serde_json` with `Value` — Fine for Now, Schemas Later

Currently tool arguments and agent outputs use `serde_json::Value` freely. For the artifact/output schema system in REPL loops, we'll want structured validation.

**Options:**
- `jsonschema-rs` — validate JSON against a schema at runtime (useful for template output validation)
- `garde` — validation attributes on Rust structs (useful for command input validation)

**Recommendation:** Add `jsonschema-rs` when implementing flow templates so that agent outputs can be validated against `output_schema` before being passed to the next stage. Don't add it now.

---

### 2.5 `tracing` (Already dep — expand use)

The app uses `log::info!/warn!/error!` macros. `tracing` is a superset of `log` that adds structured fields, spans (for timing), and hierarchical context.

For REPL loops, structured tracing is valuable:
```rust
let span = tracing::info_span!("agent_turn", run_id = %run_id, turn = turn);
let _guard = span.enter();
// All log messages inside here carry run_id and turn automatically
```

`tracing` is likely already a transitive dep; switching from `log::` macros to `tracing::` is low-effort and high-value for debugging complex multi-agent sessions.

---

### 2.6 `async-channel` vs `tokio::sync::mpsc`

For the agent worker pool, inter-agent communication (passing task results to the orchestrator) needs a channel. `tokio::sync::mpsc` is adequate. `async-channel` (from the `async-std` ecosystem) supports multiple senders AND multiple receivers, which is useful for a fan-out pattern. However, `tokio::sync::broadcast` or `tokio::sync::watch` cover most use cases within the existing tokio runtime.

**Recommendation:** Stay with `tokio::sync::*`; don't add `async-channel` as a new dependency.

---

### 2.7 `uuid` (Already in agent crate — standardize)

The agent crate already uses `uuid` (v4). The Tauri main crate may be generating UUIDs differently. Standardize on `uuid::Uuid::new_v4().to_string()` everywhere.

---

## 3. What to Build in Rust from Scratch

### 3.1 Agent Orchestrator Module (Medium effort, HIGH value)

A new module `src-tauri/src/orchestrator/` that:
- Manages a pool of active `Agent` instances as tokio tasks
- Maps `agent_id` → `CancellationToken` for cancellation
- Maps `agent_id` → `oneshot::Sender<AgentResult>` for awaiting results
- Writes agent state to `a2a.db` via the existing connection
- Emits Tauri events as agent state changes

```rust
pub struct AgentOrchestrator {
    handles: Mutex<HashMap<String, AgentHandle>>,
    app_handle: AppHandle,
    db: Arc<Mutex<Connection>>,
}

struct AgentHandle {
    cancel: CancellationToken,
    join_handle: JoinHandle<AgentResult>,
}

impl AgentOrchestrator {
    pub async fn spawn_agent(&self, config: AgentRunConfig) -> String;
    pub async fn cancel_agent(&self, id: &str);
    pub async fn get_status(&self, id: &str) -> AgentStatus;
    pub async fn await_result(&self, id: &str) -> AgentResult;
    pub fn list_active(&self) -> Vec<String>;
}
```

This replaces the current `a2a_workflow.rs` concurrency primitives with a proper runtime management structure.

**Build from scratch** because this needs to be tightly integrated with:
- The agent crate's `Agent` struct
- The Tauri `AppHandle` for event emission
- The existing `a2a.db` SQLite connection

### 3.2 Flow Template Engine (Low-medium effort)

A module that:
- Reads template JSON files from the app bundle resources
- Validates templates against a schema
- Provides a `TemplateEngine` that instantiates an `Agent` for each stage
- Handles sequential/parallel stage orchestration
- Passes output from one stage to the next

**Build from scratch** because it's simple JSON processing + orchestrator calls. No external library needed.

### 3.3 Agent Spawn Tool (Low effort)

A new `Tool` implementation in the agent crate:

```rust
pub struct SpawnAgentTool {
    orchestrator: Arc<AgentOrchestrator>,
}

#[async_trait]
impl Tool for SpawnAgentTool {
    fn name(&self) -> &str { "spawn_agent" }
    async fn execute(&self, args: Value, cancel: Option<...>) -> ToolResult {
        // Parse AgentRunConfig from args
        // orchestrator.spawn_agent(config).await
        // If wait=true: await_result
        // Return agent_id or result
    }
}
```

**Build from scratch** — it's ~100 lines.

### 3.4 Checkpoint/Resume System (Medium effort)

A module that:
- Serializes the `Session` struct to JSON (already serializable via serde)
- Writes checkpoints to `flow_checkpoints` table at configurable intervals (every N turns)
- On resume, loads the checkpoint and reconstructs the `Agent`

**Build from scratch** — straightforward serialization + DB writes.

---

## 4. What NOT to Build (Avoid Scope Creep)

### Don't build a custom DAG execution engine
The template-based sequential/parallel orchestration covers 90% of use cases. A full DAG engine with dependency resolution, backpressure, etc. is over-engineering. The primary agent's intelligence is the DAG — let the agent decide what to run next.

### Don't build a custom message broker
tokio channels are sufficient. Adding Redis, Kafka, or any message broker for local agent-to-agent communication is unnecessary complexity.

### Don't build a custom vector store
For memory retrieval in REPL loops, file-based memory (current system) plus a simple BM25 search over memory files is sufficient for v1. Don't add a vector database for launch.

### Don't build a plugin system for tools
The current tool manifest system is adequate. Opening it to third-party tool plugins is a security surface. Post-launch community involvement can expand the built-in tool set via PRs.

---

## 5. Libraries to Specifically NOT Add

| Library | Reason to Avoid |
|---|---|
| `langchain-rust` | Over-engineered for our use case; opinionated abstractions conflict with existing agent crate |
| `async-openai` | We have our own provider abstraction; duplicates it |
| `llm-chain` | Abandoned/unmaintained |
| `candle` (Hugging Face) | Large dependency; we already have llama.cpp via llama-cpp-2 |
| `redis` (for agent comms) | Overkill for local single-process orchestration |
| `actix-web` | We don't need a web server inside Tauri |

---

## 6. Build vs. Adopt Decision Matrix

| Component | Decision | Rationale |
|---|---|---|
| Agent orchestrator | **Build** | Must integrate with Tauri, a2a.db, existing Agent struct |
| Flow template engine | **Build** | Simple JSON + orchestrator; no library match |
| spawn_agent tool | **Build** | 100 lines; tightly coupled to orchestrator |
| Checkpoint system | **Build** | Uses existing Session serde; no library match |
| Type generation (specta) | **Adopt** | Mature, maintained, huge quality improvement |
| CancellationToken | **Adopt** | In tokio-util (likely already transitive) |
| JSON schema validation | **Adopt (later)** | jsonschema-rs when templates need output validation |
| ralph-orchestrator ideas | **Borrow pattern** | Supervisor-worker mental model |
| Database (sqlx) | **Defer** | Not urgent; rusqlite + WAL is adequate |
