# Cron Tasks Implementation Summary

This document summarizes all work completed in this session related to notifications, task scheduling UI, and backend scheduled-task execution.

## 1) Notifications (UI + Task Tool + Backend Durability)

### In-app notification UI
- Implemented compact stacked toast notifications on the right side of the app (bottom-right overlay).
- Style implemented as requested:
  - small cards
  - gray background
  - 3px colored left border
  - close button in top-right
- Added auto-timeout behavior for active toast visibility.

Files:
- `frontend/src/styles.css`
- `frontend/src/app/render.ts`
- `frontend/src/main.ts`

### Notification history tab in Tasks tool
- Added `Notifications` tab in Tasks tool toolbar.
- Added notification list rendering sorted by most recent.
- Added row rendering with title, description, timestamp, and optional short actions.

Files:
- `frontend/src/tools/tasks/state.ts`
- `frontend/src/tools/tasks/index.tsx`
- `frontend/src/tools/tasks/styles.css`
- `frontend/src/tools/host/viewBuilder.ts`
- `frontend/src/app/state.ts`
- `frontend/src/main.ts`

### Notification actions
- Added support for short action buttons in toast cards.
- Implemented `open-task:<taskId>` action to switch to Tasks tool and select the task.

Files:
- `frontend/src/main.ts`
- `frontend/src/tools/tasks/bindings.ts`

### System notification attempt + fallback
- Added system Notification API attempt where available.
- In-app toasts remain primary visible fallback.

File:
- `frontend/src/main.ts`

### Chime sound support
- Added notification chime playback.
- Integrated Tauri-safe URL conversion path for local file playback (`convertFileSrc` when available).
- Chime file used:
  - `/home/user/Projects/arxell/src-tauri/resources/sounds/default-chime.wav`

File:
- `frontend/src/main.ts`

### Settings toggles for sounds
- Added `Sounds` section in Settings panel with two default-on checkboxes:
  - Enable Notification chime (functional)
  - Enable Chat Question Chime (stored, reserved for future behavior)
- Added localStorage persistence for both toggles.

Files:
- `frontend/src/panels/settingsPanel.ts`
- `frontend/src/panels/index.ts`
- `frontend/src/panels/types.ts`
- `frontend/src/main.ts`

### Backend durable notification store + APIs
- Added durable notifications table to SQLite tasks DB.
- Added backend methods for notification CRUD-like operations:
  - list
  - upsert
  - mark-read
  - dismiss
- Added invoke endpoints on `tasks` tool:
  - `notifications-list`
  - `notifications-upsert`
  - `notifications-mark-read`
  - `notifications-dismiss`

Files:
- `src-tauri/src/app/tasks_service.rs`
- `src-tauri/src/tools/invoke/tasks.rs`

### Frontend/backend notification sync
- Added frontend syncing from backend notifications on bootstrap and Tasks tool activation.
- Added backend upsert on new notifications.
- Added backend mark-read and dismiss wiring from UI interactions.
- Updated close button behavior from mark-read to hard dismiss.

Files:
- `frontend/src/main.ts`

### Shared notification helper
- Added shared helper for canonical notification record creation to reduce duplicate shaping logic.

File:
- `frontend/src/notifications.ts`


## 2) Minimal Scheduling UI in Tasks Tool

Implemented minimal schedule fields and controls aligned with MVP direction.

### Task model fields added (frontend)
- `scheduledAtMs?: number | null`
- `repeat?: "none" | "hourly" | "daily" | "weekly" | "monthly" | "yearly"`
- `repeatTimeOfDayMs?: number | null`
- `repeatTimezone?: string`
- `isScheduleEnabled?: boolean`
- `nextRunAtMs?: number | null`

File:
- `frontend/src/tools/tasks/state.ts`

### Task details UI controls added
- `Scheduled` datetime-local input
- `Repeat` dropdown
- `Repeat Time` input
- `Timezone` input
- read-only `Next run` display

File:
- `frontend/src/tools/tasks/index.tsx`

### Frontend field handling + normalization
- Added schedule-related update handling in task actions/bindings.
- Added parsing/normalization for:
  - datetime-local -> `scheduledAtMs`
  - `HH:mm` -> `repeatTimeOfDayMs`
  - repeat enum
  - timezone text

Files:
- `frontend/src/tools/tasks/actions.ts`
- `frontend/src/tools/tasks/bindings.ts`


## 3) Backend Scheduling Persistence + Execution

### Durable task schema extended (SQLite)
Added task scheduling columns:
- `scheduled_at_ms`
- `repeat`
- `repeat_time_of_day_ms`
- `repeat_timezone`
- `is_schedule_enabled`
- `next_run_at_ms`

Added index:
- `idx_durable_tasks_next_run` on `next_run_at_ms`

File:
- `src-tauri/src/app/tasks_service.rs`

### Backend list/upsert/get mapping updated
- SQL and row mapping updated so schedule fields persist and round-trip.

File:
- `src-tauri/src/app/tasks_service.rs`

### Next-run computation
- Added backend computation for `next_run_at_ms` during upsert and advancement.
- Added timezone-aware recurrence implementation using:
  - `chrono`
  - `chrono-tz`
- Recurrence computed with local calendar semantics from anchor for:
  - daily
  - weekly
  - monthly
  - yearly

Files:
- `src-tauri/Cargo.toml`
- `src-tauri/src/app/tasks_service.rs`

### Due scheduled task query helper
- Added indexed due-task query helper:
  - approved tasks
  - schedule enabled
  - `next_run_at_ms <= now`
  - ordered by `next_run_at_ms`

File:
- `src-tauri/src/app/tasks_service.rs`

### Scheduled execution path
- Added scheduled execution helper in tasks invoke module:
  - fetch due tasks
  - execute through existing task payload execution path
  - append run record (`trigger_reason = "scheduled"`)
  - advance `next_run_at_ms`

File:
- `src-tauri/src/tools/invoke/tasks.rs`

### Scheduler tick loop (runtime)
- Added 15-second background scheduler loop during Tauri setup.
- Each tick runs scheduled due-task execution helper.

Files:
- `src-tauri/src/main.rs`
- `src-tauri/src/ipc/tauri_bridge.rs` (derive `Clone` for state capture)

### Manual run integration
- Manual `run-now` path now also advances `next_run_at_ms` after run append.

File:
- `src-tauri/src/tools/invoke/tasks.rs`


## 4) Build/Validation Performed

- Frontend build repeatedly validated with:
  - `cd frontend && npm run build`
- Rust backend validated with:
  - `cd src-tauri && cargo check --features tauri-runtime`

All checks passed at end of session (warnings present, no blocking errors).


## 5) Current MVP Status

Implemented:
- Notification UX + history + backend durability + actions
- Chime and settings toggles
- Minimal task scheduling UI
- Backend schedule persistence
- Timezone-aware recurrence compute
- Due task querying and active scheduler loop execution

Potential follow-ups (not required for this summary):
- Add scheduler diagnostics endpoint/status panel
- Add explicit overlap policy field/UI (currently behavior is effectively skip)
- Add richer schedule validation and edge-case tests
- Add recurring calendar test suite around DST boundaries
