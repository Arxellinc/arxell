# Tasks And Scheduler

## Overview

The Tasks workspace tool stores durable task definitions, run history, schedules, and notifications in SQLite. User-created tasks remain drafts until explicitly approved. Approved low-risk agent tasks delegate to the Pi-backed Looper instead of being recorded as successful no-ops.

Primary implementation:

- Frontend: `frontend/src/tools/tasks/`
- Durable service: `src-tauri/src/app/tasks_service.rs`
- Tool-invoke and execution policy: `src-tauri/src/tools/invoke/tasks.rs`
- Scheduler loop: `src-tauri/src/main.rs`
- Outcome reconciliation: `src-tauri/src/app/task_run_service.rs`

## Task Lifecycle

Supported states:

- `draft`: editable and not runnable.
- `approved`: explicitly approved and eligible to run.
- `complete`: completed/archived.
- `rejected`: rejected/archived.

`Save as Draft` always stores `draft`. `Save & Run` is the explicit approval path for a user task. Backend upserts preserve the requested state and never silently promote low-risk drafts.

Stable project identity and execution scope are separate fields:

- `projectId`: frontend project identifier.
- `projectRoot`: canonical execution root.

The backend also persists priority (`starred`), source (`user` or `agent`), schedule fields, and safe run metadata. Legacy records that stored a root in `projectId` are matched back to a frontend project by root during synchronization.

## Execution

Tasks currently support these durable payload kinds:

- `agent_prompt`: delegates an approved task to a real Planner → Executor → Validator → Critic Looper run backed by Pi RPC. The selected task model is applied to all phases when present.
- `tool_invoke`: allows only scoped file reads/listing and Sheets inspection/range reads, using the shared read-action policy and normal enabled-tool gateway. A low-risk label does not authorize mutation or recursive registry invocation.
- `looper_run`: starts an explicitly supplied Looper request after validating its working directory.

Automated execution remains fail-closed for non-low-risk tasks. Agent prompts run with `reviewBeforeExecute: false` because scheduled execution cannot answer an interactive planning blocker.

Run intent is persisted as `starting` before side effects, with a unique run/loop identity. Delegation changes it to `running` with a null completion timestamp; both `agent_prompt` and `looper_run` use this behavior. The reconciliation service consumes loop-state snapshots on scheduler ticks and history/notification/status reads to record succeeded or failed/stopped outcomes. Completion time, notification, claim release, and schedule changes commit together and reconciliation is idempotent. Startup preserves known terminal outcomes and records unfinished/missing work as interrupted failures, without automatic replay. Active tasks cannot be edited/deleted until stopped and reconciled. Frontend actions inspect `ToolInvokeResponse.ok`; failed saves, runs, deletes, scheduler calls, and run-history loads are surfaced instead of being reported as successful.

## Scheduling

Schedule fields:

- `scheduledAtMs`
- `repeat`: `none`, `hourly`, `daily`, `weekly`, `monthly`, or `yearly`
- `repeatTimeOfDayMs`
- `repeatTimezone`
- `isScheduleEnabled`
- `nextRunAtMs`

The Tauri runtime checks for due work every 15 seconds. Due tasks must be approved, enabled, and at or before `nextRunAtMs`.

### Correctness and overlap policy

- One-time schedules consume/clear `nextRunAtMs` when durable launch intent is created, avoiding ambiguous-crash replay.
- Manual runs do not consume an unrelated schedule.
- Due tasks are claimed atomically in an immediate SQLite transaction.
- Claims use an expiring launch lease. A persisted `starting`/`running` record additionally blocks manual/scheduled overlap, even after that lease expires.
- Recurring occurrences due during execution are skipped; completion selects the next future occurrence. Unfinished runs are recovered as failures on startup, not blindly retried.
- Daily and weekly recurrences preserve the original local time and weekday.
- Monthly and yearly recurrences clamp invalid calendar days, such as February after a day-31 anchor.
- Time-of-day schedules are constructed in the selected IANA timezone, not from UTC midnight.
- DST gaps advance to the first valid local minute; ambiguous times choose the earlier occurrence.
- Invalid timezones, recurrence values, and time-of-day values are rejected.

The scheduler requires Arxell to be running; no closed-app reminder support is implied. Persistence/scheduling failures emit a safe `tasks.scheduler.error` event rather than silent success. See `ASSISTANT_READINESS.md` for migration and regression coverage.

The Notifications tab exposes scheduler status and a manual “Run due now” control. Both use the same atomic claim path.

## Notifications

Task run notifications are durable. The frontend:

- renders unread notifications as in-app toasts;
- stores notification history in the Tasks tool;
- supports URL actions and task-opening actions;
- marks task-opening actions read in the backend;
- normalizes legacy `warning` tones to `warn`;
- optionally plays the configured notification chime.

Notification actions that open a task select the correct Tasks folder (`Drafts`, `Tasks List`, or `Archive`) for the task state.

## Verification

Relevant automated coverage includes:

- explicit draft preservation;
- project identity, root, priority, and source round trips;
- one-time schedule completion;
- atomic scheduler leases;
- daily, weekly, monthly, yearly, timezone, and invalid-timezone recurrence;
- project-boundary validation;
- real Pi/Looper request construction for agent prompts;
- scheduled run and durable notification creation;
- frontend folder/state normalization and failed-response handling.

Run:

```bash
cd frontend && npm run lint && npm test && npm run build
cd ../src-tauri && cargo check && cargo check --features tauri-runtime
cargo test --lib
cargo test --lib --features tauri-runtime tasks
```
