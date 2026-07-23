# Tasks And Scheduler

## Overview

The Tasks workspace tool stores durable task definitions, run history, schedules, and notifications in SQLite. User-created tasks remain drafts until explicitly approved. Approved low-risk agent tasks delegate to the Pi-backed Looper instead of being recorded as successful no-ops.

Primary implementation:

- Frontend: `frontend/src/tools/tasks/`
- Durable service: `src-tauri/src/app/tasks_service.rs`
- Tool-invoke and execution policy: `src-tauri/src/tools/invoke/tasks.rs`
- Scheduler loop: `src-tauri/src/main.rs`

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
- `tool_invoke`: invokes a registered tool action after task policy and project-scope checks.
- `looper_run`: starts an explicitly supplied Looper request after validating its working directory.

Automated execution remains fail-closed for non-low-risk tasks. Agent prompts run with `reviewBeforeExecute: false` because scheduled execution cannot answer an interactive planning blocker.

Run records distinguish running, succeeded, blocked, and failed outcomes. Frontend actions inspect `ToolInvokeResponse.ok`; failed saves, runs, deletes, scheduler calls, and run-history loads are surfaced instead of being reported as successful.

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

- One-time schedules clear `nextRunAtMs` after their first execution.
- Due tasks are claimed atomically in an immediate SQLite transaction.
- Claims use an expiring lease so another scheduler cannot execute the same occurrence concurrently and crashed processes can recover.
- Daily and weekly recurrences preserve the original local time and weekday.
- Monthly and yearly recurrences clamp invalid calendar days, such as February after a day-31 anchor.
- Time-of-day schedules are constructed in the selected IANA timezone, not from UTC midnight.
- DST gaps advance to the first valid local minute; ambiguous times choose the earlier occurrence.
- Invalid timezones, recurrence values, and time-of-day values are rejected.

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
