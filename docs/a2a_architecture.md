# A2A Architecture (Lightweight Functional Prototype)

## 1. Context Review of Current App

This architecture is based on the current `arx` codebase:

- Tool panels are registered via manifest + registry:
  - `src/core/tooling/types.ts`
  - `src/core/tooling/registry.ts`
  - `src/tools/*/manifest.ts`
- The existing **Tools panel** is `ToolsPanel` in:
  - `src/components/Workspace/panels/ExtensionsPanel.tsx`
  - It manages enabled/optional tools using `useToolCatalogStore`.
- The current **Agents panel** already uses an `a2a` backend surface:
  - `src/components/Workspace/panels/AgentsPanel.tsx`
  - `src-tauri/src/a2a/*` and `src-tauri/src/commands/a2a.rs`
- Backend already has event-sourced process primitives and SQLite schema:
  - processes, tasks, agent runs, edges, artifacts, memory refs, events, agent cards.

Current gap: there is no node-based visual workflow editor and no workflow-runner DAG execution for user-authored workflows.

## 2. Product Goal

Create a new tool called **A2A** for designing and executing agentic workflows with a node editor mental model:

`trigger -> transform -> act` with JSON items flowing across node connections.

Prototype must be:

- super lightweight
- minimal new dependencies
- fully functional end-to-end for core workflows
- integrated with existing tool panel architecture

## 2.1 Locked Decisions (Current)

- A2A will use a **dedicated database** (separate from the app primary DB).
- A2A must integrate current app methods for:
  - skills
  - tools (most existing tools available)
  - memory
- Guardrails remain minimal for now:
  - execution timeout
  - concurrency limits
- Observability should be high and first-class in UX.
- Canvas UX requirements:
  - mouse wheel zoom
  - keyboard zoom shortcuts
  - snap-to-grid with dense detail and a 1200x1200 workspace grid model
  - multi-select group move with edge connections preserved

## 3. Constraints and Principles

## 3.1 Dependency Budget

- Prefer **zero new runtime dependencies** for MVP.
- Do not add heavy graph/editor frameworks in v1.
- Reuse:
  - React + Zustand + existing UI utilities (`cn`, shared panel wrapper)
  - Tauri invoke/event patterns
  - existing SQLite and A2A event store

## 3.2 Scope for Functional Prototype

In-scope:

- Visual canvas with pan/zoom/select/connect
- Basic node types: webhook trigger, manual trigger, code/transform, IF branch, HTTP action, response/output
- Workflow save/load/version (basic)
- Execute full workflow and execute single node
- Execution inspector with per-node status + input/output preview
- Credentials (encrypted storage + reference by id)
- Expression engine with `{{ }}` for `$json` and upstream node references

Out-of-scope for v1:

- OAuth dance automation for every provider
- multi-machine worker scale-out
- S3 binary mode
- advanced collaboration/version history UI

## 4. Recommended Integration Strategy

## 4.1 Tool Panel Positioning

Introduce A2A as a first-class tool panel while preserving current Agents panel behavior.

- Add new tool id `a2a` (not replacing `agents` initially).
- Keep existing `agents` as process/agent operations view.
- A2A panel becomes workflow designer + execution inspector.

Rationale:

- isolates rollout risk
- keeps current agent process UX intact
- cleanly maps user requirement (“new tool called A2A”)

## 4.2 Backward-Compatible Runtime Reuse

Reuse existing `src-tauri/src/a2a/*` runtime/event ideas, but store workflow and run data in a dedicated DB.

Recommended dedicated DB file:

- `a2a.db` under app data (managed by a separate connection pool/handle).

Schema in dedicated DB:

- `a2a_workflows`
- `a2a_workflow_nodes`
- `a2a_workflow_edges`
- `a2a_workflow_runs`
- `a2a_workflow_node_runs`
- `a2a_credentials`
- `a2a_trigger_registry`
- `a2a_observability_events`

Interoperability strategy:

- Keep IDs compatible with existing process/task/card events for correlation.
- Maintain optional foreign-key-like references by id (logical links, not cross-db FK).

## 5. High-Level Architecture

## 5.1 Frontend (React)

New panel: `A2APanel`

- Left sidebar:
  - node library search
  - workflow list
  - execution history
- Center canvas:
  - infinite plane
  - node cards and edges
  - minimap
- Right side panel:
  - selected node parameters
  - expression editor
  - credential picker
  - test node action
- Top toolbar:
  - save
  - execute workflow
  - active/inactive toggle

State model:

- `a2aCanvasStore` (viewport, selection, drag state)
- `a2aWorkflowStore` (current workflow graph + dirty state)
- `a2aExecutionStore` (run status, node run records)

## 5.2 Backend (Tauri Rust Runtime)

Modules:

- `commands/a2a_workflow.rs` (new IPC commands)
- `a2a/workflow_store.rs` (CRUD + runs + credentials)
- `a2a/workflow_runtime.rs` (DAG planner/executor)
- `a2a/expression.rs` (safe expression evaluation)
- `a2a/triggers.rs` (webhook + schedule + polling)
- `a2a/interop.rs` (skills/tools/memory bridge into existing app capabilities)

Execution model:

- load workflow JSON + materialize DAG
- topological ordering
- sequential execution default
- branch parallelism with bounded concurrency
- per-node input/output JSON persisted
- emit realtime events to UI for live node status dots

Guardrails (minimal by design):

- per-node timeout
- per-run timeout
- global and per-workflow concurrency caps

## 6. Core Data Contracts

## 6.1 Workflow JSON

```json
{
  "workflow_id": "wf_xxx",
  "name": "Lead Enrichment",
  "active": false,
  "version": 3,
  "nodes": [
    {
      "id": "n1",
      "type": "trigger.webhook",
      "name": "Incoming Lead",
      "position": { "x": 120, "y": 200 },
      "params": {}
    },
    {
      "id": "n2",
      "type": "transform.map",
      "name": "Normalize",
      "position": { "x": 420, "y": 200 },
      "params": {
        "fields": {
          "email": "{{ $json.email }}",
          "domain": "{{ $json.email.split('@')[1] }}"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "n1",
      "source_output": "main",
      "target": "n2",
      "target_input": "main"
    }
  ]
}
```

## 6.2 Execution Item

Keep compatibility with your described model:

```json
{
  "json": {},
  "binary": {},
  "pairedItem": { "item": 0 }
}
```

Use arrays of these items between nodes.

## 7. Node SDK (Minimal)

Node contract (Rust trait semantics mirrored to TS-friendly schema):

- `describe()` -> metadata for node library and parameter form rendering
- `validate(params)` -> static validation errors
- `execute(ctx, input_items)` -> output arrays per output handle

Built-in nodes for prototype:

- `trigger.manual`
- `trigger.webhook`
- `trigger.schedule`
- `transform.map`
- `transform.filter`
- `logic.if`
- `http.request`
- `output.respond`
- `tool.invoke` (bridge to existing app tools through current gateway methods)
- `memory.read` / `memory.write` (bridge to existing memory APIs)
- `skill.run` (bridge for current skill execution pattern)

## 8. Expression Engine

Implement lightweight safe evaluator (no `eval`, no JS VM dependency).

v1 grammar support:

- path access: `$json.email`, `$node["Normalize"].json.domain`
- helpers: `$now`, `$today`
- basic string/number ops

Evaluation timing:

- at node execution time
- per item

Error handling:

- expression failure marks node error for item
- supports continue-on-error option (node setting)

## 9. Trigger Architecture (Prototype)

- Manual trigger: UI-only run start.
- Webhook trigger:
  - register deterministic path `/a2a/webhook/{workflow_id}/{token}`
  - route into run creation
- Schedule trigger:
  - use existing Rust async runtime timer loop
  - cron-lite support (minute/hour/day fields) for v1
- Polling trigger:
  - timer + cursor persisted in workflow node state JSON

## 10. Security Model

- Credentials encrypted at rest with AES-256-GCM using `A2A_ENCRYPTION_KEY`.
- Never return secret values to frontend once stored.
- Runtime decrypts only when executing node.
- Tool gateway policy remains authoritative for filesystem/shell/network operations.
- Node-level allowlist for outbound domains (per workflow optional policy).

Note: per current requirement, security hardening is intentionally de-prioritized in this prototype. Focus remains on timeout/concurrency guardrails plus stability.

## 11. Observability

Persist per run:

- workflow status timeline
- per-node duration
- input/output snapshot (capped)
- error stack/message
- node start/end timestamps
- queue wait time and retry count
- causal links (upstream node ids, paired item lineage)
- tool/skill/memory bridge call metadata

Emit realtime event stream:

- `a2a:workflow_run_changed`
- `a2a:node_run_changed`
- `a2a:run_trace_chunk`
- `a2a:run_metrics_changed`

This powers status dots and execution inspector.

## 12. Lightweight Dependency Plan

Frontend:

- no new graph libs in v1
- use SVG for edges + absolute-position node cards
- use pointer events and CSS transforms
- implement keyboard shortcuts for zoom/pan:
  - `Ctrl/Cmd +` zoom in
  - `Ctrl/Cmd -` zoom out
  - `Ctrl/Cmd 0` reset zoom

Backend:

- leverage existing crates (`rusqlite`, `serde_json`, `tokio`, `reqwest`)
- avoid Redis/Bull in v1
- optional queue mode can be added later via feature flag

## 13. Rollout Plan

Phase 1: Workflow CRUD + manual execution + node testing

Phase 2: Webhook/schedule triggers + execution inspector polish

Phase 3: polling triggers + credential hardening + performance

Phase 4: optional queue mode and horizontal scaling adapter

## 14. Key Risks and Mitigations

- Risk: custom canvas complexity.
  - Mitigation: strict MVP interactions only (drag, connect, select, pan/zoom).
- Risk: expression language bugs.
  - Mitigation: constrained grammar + deterministic unit tests.
- Risk: execution data bloat.
  - Mitigation: payload truncation and retention policy from day one.
- Risk: panel sprawl/confusion with Agents.
  - Mitigation: clear split: Agents = process orchestration, A2A = visual workflow builder.
- Risk: dedicated DB drift from primary app state.
  - Mitigation: explicit interop layer and correlation ids for skills/tools/memory calls.

## 15. Definition of Done (Prototype)

Prototype is considered functional when all are true:

- user can create workflow on canvas with at least 4 node types
- user can save/load workflow from DB
- user can execute full workflow manually and run single node test
- node status dots update live with success/error/warning
- execution inspector shows per-node input/output JSON snapshots
- webhook trigger can start a workflow
- credentials can be created, selected by node, and used at runtime encrypted
- most existing app tools are invokable via A2A `tool.invoke` nodes
- skills and memory can be read/written from A2A nodes
- canvas supports dense grid snapping and group move with stable edges
- all shipped with no major dependency additions and no heavy editor framework

## 16. Canvas Interaction Spec (Locked)

- Workspace grid: 1200x1200 logical grid.
- Snap behavior:
  - node origin and resize handles snap to grid units
  - edge bend/control points snap when manually adjusted
- Group behavior:
  - user can create group selection by drag box or Shift+click
  - moving group updates node positions atomically
  - connected edges remain attached to their source/target handles
- Zoom:
  - wheel and trackpad pinch
  - keyboard shortcuts above
  - minimap viewport updates in real time
