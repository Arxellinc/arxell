# Auto Mode + Durable Tasks Final Plan

## Goals

- Add a durable task system that supports long-duration autonomous work.
- Allow the chat UI rocketship Auto Mode to execute pending and scheduled tasks without user interaction.
- Keep autonomy safe by enforcing strict project-directory confinement and explicit approval workflows.
- Support task execution via agent prompt, looper runs, and tool invocations.
- Show estimated task cost before execution based on token estimates and model pricing.

## Core Domain Model

- **Project**: owns directory scope (`root_path`) and contains goals/tasks.
- **Goal**: long-running objective for open-ended work; parent for agent-created tasks.
- **Task**: discrete unit of work.
- **Schedule**: recurrence/trigger rules for a task.
- **Run**: one execution attempt of a task.
- **Proposal**: an item in `draft` state pending user decision.
- **Checkpoint**: durable summary state for goal progress and restart recovery.

## V1 Scope (Keep It Simple)

- Auto mode: `off` and `safe` only (defer `full`).
- Schedule types: `once` and `interval` (defer `cron`/`rrule`).
- Fixed policies in v1:
  - Misfire: `run_once`
  - Overlap: `skip`
- Single global concurrency limit (default: `2`).
- Task payload types in v1:
  - `agent_prompt`
  - `tool_invoke`
  - `looper_run`
- Agent-created low-risk tasks can auto-approve in Auto Safe.
- Agent-created non-low-risk items default to `draft`.
- Durable SQLite persistence and startup reconciliation.

## Explicit Non-Goals for V1

- OS-native background scheduling while app is closed.
- RRULE support.
- Per-tool concurrency limits.
- Complex budget enforcement policies.
- Natural-language scheduling parser.

## Safety and Permission Rules

1. Auto Safe executes only `approved` tasks.
2. Agent-created low-risk tasks may be auto-approved by policy; medium/high-risk items start in `draft`.
3. High-risk actions are never auto-executed in v1.
4. Tool permissions are snapshotted at task/schedule approval time.
5. Permissions cannot expand silently.
6. User can pause/revoke/stop automation at any time.
7. Every run produces a durable audit trail.

## Project Directory Confinement (Hard Requirement)

- Every executable task must reference a `project_id`.
- Backend resolves `project_root` from trusted persisted project metadata.
- For all file-capable actions:
  - canonicalize target path (or nearest existing parent for create)
  - ensure canonical target is under canonical `project_root`
  - deny otherwise with `blocked_policy`
- Resolve symlinks before allow/deny decisions.
- Never trust frontend-provided file scope for authorization.
- Snapshot allowed roots at task approval (`allowed_roots_json`, default `[project_root]`).

## Execution Strategies

Task execution uses typed payload strategies:

- `agent_prompt`: run the task through the chat/agent pipeline.
- `tool_invoke`: execute existing invoke-tool contracts (`toolId`, `action`, typed payload).
- `looper_run`: trigger looper start/status lifecycle via existing looper path.

Each strategy is gated by the same policy + filesystem scope checks before execution.

## Simplified State Model

Use only four task/project business states in v1:

- `draft`
- `approved`
- `complete`
- `rejected`

Rules:

- `draft` items are proposals and are non-executable.
- Schedules attached to non-approved tasks remain disabled.
- Approval (`draft -> approved`) promotes item to execution eligibility.
- Completion (`approved -> complete`) marks finished business intent.
- Rejection (`draft/approved -> rejected`) cancels pending runs and blocks future enqueue.
- Execution lifecycle stays in `task_runs.status`; do not overload task state with runtime statuses.

## Estimated Cost Model

Tasks must carry an estimate before execution planning:

- `estimated_input_tokens`
- `estimated_output_tokens`
- `estimated_total_tokens`
- `estimated_cost_usd`
- `estimate_confidence` (`low|medium|high`)

Computation:

- `estimated_total_tokens = prompt + context + expected_output`
- `estimated_cost_usd = input_tokens * input_price + output_tokens * output_price`
- Pricing uses model pricing table per 1M tokens.
- If model/pricing unknown, use default profile and mark low confidence.

Run-time tracking:

- store actual token usage and actual cost per run.
- store pricing snapshot used at run start.
- show estimate vs actual in run history.

## Data Schema (SQLite)

### `scheduler_projects`

- `id`, `name`, `root_path`, timestamps.

### `goals`

- `id`, `project_id`, `title`, `objective`, `status`.
- `auto_mode` (`off|safe`).
- caps: `max_concurrent_runs`, `max_runs_per_hour`, optional daily budget fields.
- `allowed_tools_json`, timestamps.

### `tasks`

- `id`, `project_id`, optional `goal_id`.
- `title`, `description`, `task_type`, `payload_json`.
- `payload_kind` (`agent_prompt|tool_invoke|looper_run`).
- `state` (`draft|approved|complete|rejected`), `created_by`, `risk_level`.
- `allowed_tools_json`, `allowed_roots_json`.
- provenance: `origin_goal_id`, `origin_run_id`.
- estimate fields (or `estimate_json`).
- timestamps.

### `task_schedules`

- `id`, `task_id`, `schedule_type`, `schedule_expr`, `timezone`, `next_run_at`.
- `is_enabled`, `misfire_policy` (v1 fixed), `overlap_policy` (v1 fixed).
- timestamps.

### `task_runs`

- `id`, `task_id`, optional `schedule_id`, `goal_id`, `project_id`.
- `status`, `trigger_reason`, `scheduled_for`, `started_at`, `completed_at`.
- attempts fields.
- `input_json`, `result_json`, `error`.
- policy audit: `policy_decision`, `policy_reason`, `why_selected`.
- executor audit: `executor_kind`, `executor_target`, `external_ref`.
- scope snapshots: `tool_snapshot_json`, `filesystem_scope_json`, pricing/cost snapshots.
- lease fields for crash-safe claiming.
- timestamps.

### `goal_checkpoints`

- `id`, `goal_id`, `summary`, `state_json`, `created_at`.

## Runtime Services

1. **Task Service**
   - CRUD tasks/goals/proposals.
   - approval transitions.

2. **Scheduler Service**
   - periodic tick loop.
   - evaluate due schedules and enqueue runs.
   - startup reconciliation.

3. **Execution Queue**
   - durable pending runs.
   - lease/claim pending runs.
   - global concurrency semaphore.

4. **Task Runner**
   - dispatch by `payload_kind` (`agent_prompt`, `tool_invoke`, `looper_run`).
   - emit progress events.

5. **Policy Gate**
   - evaluate auto mode, task state/risk, tool scope, file scope, and cost threshold.
   - return: `allow`, `require_confirmation`, or `deny`.

## UI Field Contract (Prevent Field Drift)

Track explicit UI exposure for each persisted field so functionality does not regress during backend migration.

### Existing Task Tool UX To Preserve

- Keep current list/detail layout, folders, sort controls, JSON draft/apply, and run button placement.
- Keep folder mental model in UI (`Tasks List`, `Archive`, `Drafts`) while mapping to simplified backend states.

### State-to-UI Mapping

- `Drafts` folder => tasks with `state = draft`.
- `Tasks List` folder => tasks with `state = approved`.
- `Archive` folder => tasks with `state in (complete, rejected)`.

### Field Exposure Matrix (V1)

- **Always visible**: `id`, `title/name`, `description`, `project_id`, `payload_kind`, `state`, `risk_level`, `estimated_cost_usd`, `updated_at`.
- **Details pane visible**: `allowed_tools_json` (summarized), schedule summary, estimate token fields, model/pricing profile.
- **Run history visible**: run status, trigger reason, duration, estimated vs actual cost, policy decision/reason, blocked reason.
- **Stored but not primary UI**: raw `payload_json`, scope snapshots, executor refs (`external_ref`), lease metadata.

### Change Safety Rule

- Any new persisted task/schedule/run field must be classified as:
  1. visible in list,
  2. visible in details,
  3. visible in run history, or
  4. internal-only.
- Add this classification to implementation PR checklist to avoid fields falling through cracks.

## Scheduler and Queue Semantics

- Use polling scheduler loop (5-15s interval).
- For each due schedule, transactionally:
  - verify still due
  - create run row
  - advance `next_run_at`
  - commit
- enqueue after commit.
- If enqueue fails, run remains `pending` and gets recovered.
- On startup:
  - mark stale running runs as interrupted/failed by policy
  - re-enqueue claimable pending runs
  - reconcile past-due schedules with `run_once`

## UI and UX Plan

### Rocketship Auto Mode

- Add top-header rocketship toggle for current chat/project context.
- Modes in v1: `Off`, `Auto Safe`.
- Show scope text: "Confined to project: <project name/path>".
- Provide emergency stop action.

### Proposals Surface

- Add proposal queue view:
  - Project proposals
  - Task proposals
  - Schedule proposals
- Card actions: `Approve`, `Edit`, `Reject`.
- Show requested tools, risk, schedule summary, and estimated cost.
- Auto-approve indicator for low-risk agent-created tasks (with audit note).

### Run History

- Display:
  - estimated vs actual cost
  - status and duration
  - policy decision and reason
  - blocked path/tool reasons when denied

## Integration with Existing Architecture

- Keep frontend as render/input/orchestration only.
- Use backend Rust services for persistence, policy, scheduling, and execution.
- Route tool/looper actions through existing invoke/registy boundaries.
- Emit structured events for run progress/state updates.

## Implementation Phases

### Phase 1: Durable Core

- Add migrations and repository layer.
- Migrate tasks persistence from frontend local storage to backend SQLite.
- Implement run-now execution and run history.

### Phase 2: Scheduling MVP

- Add `once` and `interval` schedules.
- Add scheduler tick + queue + reconciliation.
- Add pause/resume schedule controls.

### Phase 3: Auto Safe + Proposals

- Add goals and auto mode state.
- Add proposal workflow using simplified states (`draft|approved|complete|rejected`) and approval UI.
- Add policy gate and hard project confinement.
- Add low-risk auto-approval policy path with audit logging.

### Phase 4: Looper/Tool Task Strategies

- Implement `tool_invoke` and `looper_run` execution strategies.
- Add executor audit fields and lifecycle events.

### Phase 5: Cost Estimation + Reporting

- Add estimate model and pricing snapshots.
- Show estimate before approval/run and actual after completion.
- Add thresholds to route expensive tasks to approval.

## Acceptance Criteria

- Auto Safe runs approved low-risk tasks without user interaction.
- No run can write/create/modify outside its project root.
- Agent-created low-risk tasks can auto-approve; all others remain drafts until approved.
- Tasks can execute via looper/tool invoke strategies when appropriate.
- Every run has durable audit fields and estimate/actual cost records.
- Restart recovery prevents run loss and minimizes duplicate execution.
- UI field exposure matrix is maintained for task/schedule/run fields.

## Default Configuration (V1)

- `auto_mode`: `safe`
- `misfire_policy`: `run_once`
- `overlap_policy`: `skip`
- `max_global_concurrent_runs`: `2`
- `schedule_types`: `once`, `interval`
- `allowed_roots`: `[project_root]`
- high-risk actions: not auto-executable
- low-risk agent-created tasks: auto-approve enabled

## Implementation Checklist (Owner-Ready)

| Area | Task | Owner | Done When |
|---|---|---|---|
| Backend | Add SQLite migrations for `scheduler_projects`, `goals`, `tasks`, `task_schedules`, `task_runs`, `goal_checkpoints` with simplified 4-state model | Backend | Migrations apply cleanly on new and existing DBs |
| Backend | Implement repositories/services for task CRUD, state transitions, schedule CRUD, run lifecycle | Backend | API operations pass unit tests and return typed DTOs |
| Backend | Enforce project-root confinement for all file-capable execution paths | Backend | Path traversal and symlink escape tests fail closed |
| Backend | Implement policy gate with low-risk auto-approve path and audit reasoning | Backend | Decisions persisted in run audit fields and reproducible in tests |
| Backend | Implement scheduler tick (`once`, `interval`) with transactional due-run creation | Backend | No duplicate runs under restart/race test scenarios |
| Backend | Implement queue claim/lease/recovery loop for pending runs | Backend | Startup recovery reclaims pending runs correctly |
| Backend | Implement runner strategies for `agent_prompt`, `tool_invoke`, `looper_run` | Backend | Each strategy executes through existing registry/invoke boundaries |
| Frontend | Keep current tasks tool layout/interaction patterns intact | Frontend | No regressions in list/detail/folders/sort/JSON/apply/run affordances |
| Frontend | Switch tasks data source from local storage to backend DTOs | Frontend | Tool works after restart with durable backend persistence |
| Frontend | Add rocketship Auto Safe toggle and emergency stop in header | Frontend | User can turn Auto Safe on/off and stop immediately |
| Frontend | Add proposals surface based on `draft` tasks/projects/schedules | Frontend | User can approve/edit/reject proposal items end-to-end |
| Frontend | Add estimated cost display (task details + approval cards + run history compare) | Frontend | Estimate and actual values appear consistently in UI |
| Shared | Maintain UI field exposure matrix for every new persisted field | Backend + Frontend | PR checklist includes classification and reviewer sign-off |
| QA | Create integration tests for state mapping (`draft/approved/complete/rejected`) and folder views | QA | Folder counts/views align with backend states |
| QA | Add end-to-end tests for auto-approved low-risk tasks and blocked high-risk tasks | QA | Auto Safe behavior matches policy without user input |
| QA | Add restart/crash recovery tests for scheduled and pending runs | QA | No run loss; duplicate execution remains within accepted constraints |

### PR Checklist Gate (Required)

- [ ] New fields added this PR are classified as list-visible, details-visible, run-history-visible, or internal-only.
- [ ] Project-root confinement is validated for any new file-capable action path.
- [ ] Task business state transitions only use `draft`, `approved`, `complete`, `rejected`.
- [ ] Runtime lifecycle changes are represented in `task_runs.status`, not task business state.
- [ ] Low-risk auto-approval decisions emit durable audit reason fields.
- [ ] Existing task tool UX patterns remain intact unless explicitly approved in design review.
