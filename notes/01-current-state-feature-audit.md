# Current State Feature Audit (Arx 0.8.0)

## Executive Summary
The app already has a strong base for the pivot to long-duration orchestration:
- Mature desktop shell: Tauri v2 + React + Zustand with broad tool surfaces.
- Real orchestration primitives: A2A process/event model and separate A2A workflow database.
- Functional Flow editor: canvas, templates, node library, autosave, run history, node test, trace events.
- Broad node catalog in UI.

Main gap:
- The Flow UI exposes many node types that are partially implemented, stubbed, or not yet production-safe for autonomous long-running loops.

Implication:
- The pivot should focus on runtime hardening and narrowing to a reliable "golden path" set of loop nodes before adding more features.

## Product Surfaces Found

### Desktop shell and core UX
- Three-pane workspace (`Sidebar`, `Chat`, `Workspace`) with tool-panel model.
- Voice-first interaction pipeline with barge-in behavior and partial prefill warmup.
- Local + API model paths, including local runtime manager and serve panel.

### Tool ecosystem
Registered tool manifests include:
- `flow`, `project/agents`, `tasks`, `notes`, `serve`, `llm`, `terminal`, `web`, `mcp/extensions`, `coder/pi`, `business`, `email`, `sync`, `avatar`, `settings`, `tools` manager.

This is a strong foundation for delegated specialized agents.

### Backend IPC and command surface
Tauri command registration includes:
- Chat streaming + delegation streaming.
- Project/conversation CRUD.
- Voice controls and diagnostics.
- A2A process + agent card events.
- A2A workflow CRUD/runs/templates/credentials/node test.
- Tool gateway policy layer.
- Model manager, memory, workspace, terminal, logs.

## A2A / Flow Status

### What is implemented and usable today
- Dedicated `a2a.db` initialized at startup.
- Workflow entities: workflow, run, node run, templates, credentials, trigger registry, observability events.
- Runtime safeguards:
  - Global and per-workflow concurrency caps.
  - Run timeout and timed-out status.
- Event emission to UI:
  - `a2a:workflow_changed`
  - `a2a:run_trace_chunk`
- Topological DAG ordering with cycle detection.

### Flow editor capabilities
- Large node library, zoom/pan, snap grid, grouping, multi-selection.
- Edge ports with role-based compatibility checks.
- Autosave + explicit save.
- Import/export JSON.
- Run selection and run detail fetch.

### Runtime mismatch risk (critical)
UI lists many node types, but runtime behavior varies:
- Fully or mostly implemented: mapping/filter/switch, HTTP request, `llm.query`, memory read/write, sqlite/postgres/redis, send email.
- Pass-through or simplified semantics: `core.merge`, `ai.chat_model`, `ai.memory`, `ai.tool`.
- Not implemented / intentionally disabled: inline `util.execute_workflow` subworkflow, MySQL/MariaDB, MongoDB, MSSQL runtime.

This mismatch creates user trust and stability risk in a public launch.

## Related A2A Process Model
Separate from Flow workflows, the app has event-sourced process/agent/task primitives:
- Process status changes.
- Agent runs and task creation/status.
- Edge declarations and artifacts/memory refs.
- Demo process seeding.

This is highly relevant to "Ralph Loops" because it already represents delegations, dependencies, and artifacts.

## Launch Readiness Summary for Goal Shift
Good:
- Architecture is already aligned with a delegation-first future.
- Key subsystems exist (workflow DB, tool gateway, memory, skills).

Not good:
- Flow currently behaves like a broad prototype with partial implementations.
- Long-duration reliability controls (durable scheduling, resume/retry semantics, strict idempotency contracts) are incomplete for public expectations.

Recommendation:
- Productize a narrow but robust loop core this week.
- Defer breadth and keep hidden/experimental node families disabled by default.
