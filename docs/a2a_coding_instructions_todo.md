# A2A Coding Instructions and TODO (Prototype Build Guide)

## 1. Build Objective

Deliver a working A2A tool panel with node-based workflow authoring and execution, integrated into this app’s existing tool architecture and Tauri backend.

## 2. Implementation Rules

- Keep dependencies minimal; do not add heavy graph/workflow frameworks for MVP.
- Prefer extending existing `a2a` Rust modules and existing panel/store patterns.
- Preserve existing `agents` panel behavior while introducing new `a2a` panel.
- All new backend commands must be exposed via `src/lib/tauri.ts` wrappers.
- Log and persist enough execution data for UI inspector.
- Use a dedicated A2A database from day one.
- Integrate existing app skills/tools/memory methods into node execution.
- Keep guardrails minimal: timeout and concurrency only.

## 3. File-Level Work Plan

## 3.1 Frontend Tool Registration

1. Update `src/core/tooling/types.ts`.
- Add `"a2a"` to `ToolPanelId` union.

2. Create `src/tools/a2a/manifest.ts`.
- Manifest title: `A2A`.
- Description: `Build and run agentic workflows`.
- Category: `main`.
- Panel component: `A2APanel`.

3. Update `src/tools/index.ts`.
- Export `a2aToolManifest`.

4. Update `src/core/tooling/registry.ts`.
- Register new tool.
- Place near `agents` in `TOOL_ORDER`.

5. Update `src/store/toolCatalogStore.ts`.
- Add `a2a` to `ALL_TOOL_IDS`.
- Add `a2a` to default enabled list.

## 3.2 Frontend Panel and Stores

1. Add panel component.
- Create `src/components/Workspace/panels/A2APanel.tsx`.
- Base layout: left sidebar / center canvas / right config / top toolbar.

2. Add workflow state store.
- Create `src/store/a2aWorkflowStore.ts`.
- State:
  - current workflow id
  - node list
  - edge list
  - viewport transform
  - selected node ids
  - dirty flag

3. Add execution state store.
- Create `src/store/a2aExecutionStore.ts`.
- State:
  - active run id
  - per-node run status
  - last input/output previews
  - error text per node

4. Add canvas primitives.
- Create `src/components/Workspace/panels/a2a/Canvas.tsx`
- Create `.../NodeCard.tsx`
- Create `.../EdgeLayer.tsx`
- Create `.../MiniMap.tsx`
- Create `.../NodeLibrary.tsx`
- Create `.../NodeConfigPanel.tsx`
- Create `.../ExecutionInspector.tsx`

5. UI behavior to implement.
- Pan canvas by dragging background.
- Zoom with wheel.
- Zoom with keyboard shortcuts:
  - `Ctrl/Cmd +`
  - `Ctrl/Cmd -`
  - `Ctrl/Cmd 0` reset
- Node drag and drop.
- Shift multi-select.
- Connection drag from output to input handles.
- Node click opens right-side parameter editor.
- Snap node movement to dense grid.
- Support 1200x1200 logical grid model.
- Group selected nodes and move as a unit while preserving edge attachments.

## 3.3 Frontend API Wrappers

1. Update `src/lib/tauri.ts`.
- Add workflow CRUD wrappers.
- Add workflow run wrappers.
- Add node test wrapper.
- Add credential CRUD wrappers.
- Add trigger registration wrappers.

2. Optional: `src/core/tooling/client.ts`.
- Add gateway methods if A2A actions route via `cmd_tool_invoke`.

## 3.4 Backend Schema and Store (Dedicated DB)

1. Create dedicated DB module.
- Add `src-tauri/src/a2a/db.rs` for second DB connection lifecycle.
- DB file name: `a2a.db` in app data directory.

2. Add schema in dedicated workflow store.
- Add `src-tauri/src/a2a/workflow_store.rs`.
- Tables:
  - `a2a_workflows`
  - `a2a_workflow_nodes`
  - `a2a_workflow_edges`
  - `a2a_workflow_runs`
  - `a2a_workflow_node_runs`
  - `a2a_credentials`
  - `a2a_trigger_registry`
  - `a2a_observability_events`
- Add indexes for workflow id + updated_at + run lookup.

3. Add Rust structs for new records.
- Keep serde-serializable with frontend-compatible snake_case fields.

4. Add CRUD/query functions in store.
- `create_workflow`, `update_workflow`, `list_workflows`, `get_workflow`.
- `create_run`, `update_run_status`, `append_node_run`.
- `create_credential`, `list_credentials`, `delete_credential`.

## 3.5 Backend Runtime Engine

1. Create `src-tauri/src/a2a/workflow_runtime.rs`.

2. Implement DAG planner.
- Build adjacency map from node/edge rows.
- Validate acyclic graph at save-time and pre-run.
- Topological sort for execution order.

3. Implement node executor registry.
- Internal map from `node.type` to execute function.
- Node interface:
  - input items
  - params JSON
  - credential references
  - execution context

4. Implement built-in nodes for MVP.
- `trigger.manual`
- `trigger.webhook`
- `transform.map`
- `logic.if`
- `http.request`
- `output.respond`
- `tool.invoke`
- `skill.run`
- `memory.read`
- `memory.write`

5. Implement item contract.
- Input/output arrays shaped as:
  - `{ json, binary?, pairedItem? }`

6. Implement partial failure behavior.
- Node setting: `continue_on_error` boolean.
- Mark failed item but keep pair mapping for remaining items.

7. Guardrails (minimal only).
- Per-node timeout.
- Per-run timeout.
- Global concurrency limit.
- Per-workflow concurrency limit.

## 3.6 Expression Engine

1. Create `src-tauri/src/a2a/expression.rs`.

2. Implement minimal parser/evaluator.
- Support:
  - `{{ $json.path }}`
  - `{{ $node["Name"].json.path }}`
  - `{{ $now }}` and `{{ $today }}`
- Return typed JSON values.

3. Constraints.
- No arbitrary code execution.
- Max expression length.
- Timeout/step limit.

## 3.7 Credential Encryption

1. Create `src-tauri/src/a2a/credentials.rs`.

2. Implement encryption.
- AES-256-GCM with key derived from `A2A_ENCRYPTION_KEY`.
- Store encrypted blob + metadata only.

3. Runtime usage.
- Decrypt in memory only at execution time.
- Never return plaintext secrets to frontend read APIs.

## 3.8 Tauri Commands and Wiring

1. Create `src-tauri/src/commands/a2a_workflow.rs`.
- Commands:
  - workflow list/get/create/update/delete
  - run create/get/list
  - run execute
  - node execute test
  - credential create/list/delete

2. Register module in:
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs` `generate_handler![]`

3. Optional gateway routing.
- Extend `src-tauri/src/commands/tool_gateway.rs` policies/actions with `a2a.*` if required.

4. AppState updates.
- Add dedicated A2A DB handle to app state for command access.
- Keep primary app DB unchanged.

## 3.9 Trigger Services

1. Create `src-tauri/src/a2a/triggers.rs`.

2. Webhook handling.
- Add endpoint registration in trigger registry table.
- Dispatch incoming payload as trigger output item.

3. Schedule handling.
- Lightweight scheduler loop in tokio task.
- cron-lite parser for MVP.

4. Polling handling.
- Timer with per-node cursor state persisted.

## 3.10 Events and Live Updates

1. Emit Tauri events on run progress.
- `a2a:workflow_run_changed`
- `a2a:node_run_changed`
- `a2a:run_trace_chunk`
- `a2a:run_metrics_changed`

2. UI subscriptions.
- `A2APanel` listens and updates status dots and inspector in near real-time.

## 4. Detailed TODO Checklist

## 4.1 Backend First (recommended order)

- [ ] Add dedicated A2A DB connection module (`a2a.db`).
- [ ] Add DB schema migrations in dedicated workflow store for workflow + run + credentials tables.
- [ ] Add strongly typed row structs and serializers.
- [ ] Add store methods for workflow CRUD.
- [ ] Add store methods for run tracking and node run snapshots.
- [ ] Implement `workflow_runtime.rs` with DAG validation and topological execution.
- [ ] Implement built-in node executors (`manual`, `webhook`, `map`, `if`, `http`, `respond`).
- [ ] Implement bridge nodes (`tool.invoke`, `skill.run`, `memory.read`, `memory.write`).
- [ ] Implement expression evaluator and tests.
- [ ] Implement credential encryption/decryption and tests.
- [ ] Add Tauri command module for workflow operations.
- [ ] Register commands in `lib.rs`.
- [ ] Emit run/node status events for frontend subscriptions.
- [ ] Add minimal guardrails (timeouts + concurrency caps only).

## 4.2 Frontend Next

- [ ] Add new tool id and manifest wiring.
- [ ] Create `A2APanel` shell with top/left/center/right layout.
- [ ] Build canvas transform and pan/zoom.
- [ ] Add keyboard zoom shortcuts (`Ctrl/Cmd +/-/0`).
- [ ] Build node rendering and selection model.
- [ ] Build edge rendering and connection creation.
- [ ] Implement snap-to-grid on node move/connect.
- [ ] Implement 1200x1200 logical grid model and rendering.
- [ ] Implement multi-node grouping and group move with edge anchors preserved.
- [ ] Build node parameter editor with expression toggle and test-node button.
- [ ] Build workflow list and save/load actions.
- [ ] Build execution inspector with input/output JSON preview.
- [ ] Wire live run status via Tauri event listeners.
- [ ] Add wrappers in `src/lib/tauri.ts` and consume from stores.

## 4.3 Hardening

- [ ] Add payload truncation for stored input/output snapshots.
- [ ] Add retention policy command for old run cleanup.
- [ ] Add schema validation before workflow save.
- [ ] Add run concurrency cap (global + per workflow).
- [ ] Add clear user-facing error messages for expression/runtime failures.

## 5. API Contract Draft

Use command names with stable prefix:

- `cmd_a2a_workflow_list`
- `cmd_a2a_workflow_get`
- `cmd_a2a_workflow_create`
- `cmd_a2a_workflow_update`
- `cmd_a2a_workflow_delete`
- `cmd_a2a_workflow_run_start`
- `cmd_a2a_workflow_run_get`
- `cmd_a2a_workflow_run_list`
- `cmd_a2a_workflow_node_test`
- `cmd_a2a_credential_create`
- `cmd_a2a_credential_list`
- `cmd_a2a_credential_delete`

## 6. Test Plan (Minimum)

Backend unit tests:

- DAG cycle detection
- topological sort order
- expression evaluation correctness
- credential encryption roundtrip
- node execution contract shape

Backend integration tests:

- create workflow -> run workflow -> verify run/node records
- webhook trigger dispatch flow
- if-branch routing true/false
- tool/skill/memory bridge execution flow

Frontend tests/manual checklist:

- pan/zoom/select/connect interactions
- keyboard zoom shortcuts
- dense grid snapping behavior
- group move preserves edge connections
- node save/load persistence
- node test displays output
- workflow run updates status dots and inspector
- run error shows stack/message in UI

## 7. Prototype Exit Criteria

- At least one trigger, one transform, one conditional, and one action node run successfully in sequence.
- A branching workflow executes with parallel branch support.
- Webhook can trigger a persisted workflow.
- User can inspect node I/O and errors after execution.
- Credentials are encrypted and usable by HTTP node.
- Tool, skill, and memory integrations are available in workflow nodes.
- Guardrails are active for timeout and concurrency.
- Grid snapping and grouping behavior supports organized large flows.
- No heavy new dependencies introduced for canvas/workflow engine.

## 8. Suggested Milestone Breakdown

Milestone 1 (2-3 days): dedicated DB wiring + schema + command scaffolding + workflow CRUD.

Milestone 2 (3-5 days): runtime DAG executor + basic nodes + bridge nodes + run persistence.

Milestone 3 (3-5 days): A2A panel canvas + parameter editor + run inspector + grid/group UX.

Milestone 4 (2-3 days): triggers + credentials + observability stream + minimal guardrails.

Milestone 5 (1-2 days): validation, docs, and bug-fix pass.
