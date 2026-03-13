# Business Analyst Premium Tool - Implementation Backlog

## Objective
Deliver a production-grade premium `Business Analyst` tool that autonomously generates:
- business plan
- market analysis
- economic + AI feasibility analysis
- go-to-market plan
- technical roadmap
- investor pitch deck

## Phase 1 (Scaffold + MVP Runtime)

### BA-001: Premium Tool Registration
- Add `business` tool manifest and panel registration.
- Gate initial visibility via tool manager unlock flow.
- Acceptance: tool appears in toolbar only after unlock/install.

### BA-002: Run Domain Model
- Introduce run/task/artifact types with persisted store.
- Status model: `draft -> intake -> running -> reviewing -> completed | failed`.
- Acceptance: runs persist across app reload.

### BA-003: Intake Capture UI
- Build intake form capturing:
  - business idea
  - customer
  - geography
  - budget
  - timeline
  - constraints
- Acceptance: can create run with validated intake.

### BA-004: Specialist Agent Task Graph
- Define specialist task graph:
  - market research
  - economic analysis
  - AI feasibility
  - GTM strategy
  - financial model
  - technical roadmap
  - pitch deck
- Acceptance: tasks show dependencies and run status transitions.

### BA-005: Autonomous Run Controller (MVP)
- Implement local orchestrator (state-machine driven, simulated external execution).
- Add `start`, `pause`, `resume`, `cancel`.
- Acceptance: run advances through tasks and produces artifacts.

### BA-006: Artifact Rendering
- Render generated artifacts with citations/assumptions placeholders.
- Artifacts:
  - business plan
  - market analysis
  - economic feasibility
  - AI feasibility
  - GTM plan
  - technical roadmap
  - pitch deck outline
- Acceptance: user can switch and read all artifacts.

### BA-007: Export
- Export selected artifact bundle as JSON/Markdown.
- Acceptance: one-click copy/export in panel.

### BA-008: Premium Usage Tracking (Local)
- Track run start/end, elapsed time, and estimated token budget.
- Acceptance: run timeline includes usage metadata.

## Phase 2 (Data Connectors + Real Research)

### BA-101: Connector Abstraction
- Interface: `fetch`, `normalize`, `cache`, `provenance`.
- Acceptance: connectors share one execution contract.

### BA-102: Federal/Public Connectors
- Implement connectors for:
  - data.gov
  - BLS
  - BEA
  - Census
  - FRED
  - Software Equity SaaS M&A database
- Acceptance: each connector returns normalized records.

### BA-103: Evidence Graph
- Map every analysis claim to evidence nodes.
- Acceptance: artifact sections show source references.

### BA-104: Quality Gates
- Add contradiction and missing-data checks before completion.
- Acceptance: run blocked until high-severity QA issues are resolved.

## Phase 3 (Backend + Billing + Production)

### BA-201: Tauri Command Surface
- Add commands:
  - `ba_start_run`
  - `ba_get_run`
  - `ba_pause_run`
  - `ba_resume_run`
  - `ba_get_artifacts`
  - `ba_export_bundle`
- Acceptance: frontend switched from local simulation to backend execution.

### BA-202: Entitlement and Billing
- Integrate premium entitlement checks + metering hooks.
- Acceptance: locked access enforced when not entitled.

### BA-203: Observability and Audit
- Structured logs for run stages/source calls/errors.
- Acceptance: full execution trace for each run.

## Current Status
- `Phase 1` scaffolding started in this branch:
  - tool registered
  - persisted run store
  - intake + task graph + artifacts UI
  - local autonomous execution controller
