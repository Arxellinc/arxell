# Flow -> Ralph Loops Target Architecture

## Goal
Enable the primary agent to create durable, long-running, organized loops via Flow, while delegating specialist architect agents for bespoke workflows.

## Recommendation: Build a Hybrid, Not a Hard Fork

Use current code as the base orchestration runtime and adopt selected ideas from `ralph-orchestrator` style systems:
- durable run state machine,
- explicit task queue semantics,
- worker lease/heartbeat,
- replayable event log.

Do not fully replace current system this week.

## Proposed Ralph Loop Model

### Loop entities
- `loop_definition` (template + policy + ownership)
- `loop_run` (state machine instance)
- `loop_step` (node execution units)
- `loop_handoff` (delegate agent assignment and contract)
- `loop_checkpoint` (resume cursor + materialized context)

### Loop states
`draft -> ready -> running -> waiting_external -> paused -> retrying -> succeeded | failed | canceled`

### Delegation model
Primary agent delegates to architect agents by card/capability profile:
- coding architect
- business analyst architect
- diligence architect
- personal-assistant architect
- automation architect

Each delegate receives:
- bounded objective,
- allowed tools/modes,
- input schema,
- expected output schema,
- SLA budget (time/token/cost).

## What to Build in Rust From Scratch

1. Durable scheduler/worker core
- Separate scheduler loop from node execution.
- Use DB-backed pending queue with leases.

2. Checkpointing/resume primitives
- Persist node cursor and normalized execution context every step.

3. Retry policy engine
- Per-node retry policy with exponential backoff + max attempts + dead-letter reason.

4. Capability contract validator
- Validate requested tool/mode/host/path against policy before execution.

5. Loop template compiler
- Convert high-level templates into executable workflow definitions with strict schema checks.

## What to Reuse from Existing Arx
- Existing `a2a.db` schema as base tables.
- Existing run/node trace events.
- Existing tool gateway policy framework.
- Existing memory and skills command surfaces.
- Existing Flow panel UX with selective hardening.

## What to Borrow (Conceptually) from Ralph-Orchestrator Patterns
- Event-sourced execution timeline.
- Explicit worker ownership and lease renewal.
- Durable retries and resumable steps.
- Separation of orchestration intent from execution workers.

## Libraries to Consider (Rust)
Keep additions minimal and pragmatic:
- `tokio-util`: cancellation token and task control ergonomics.
- `tracing` + `tracing-subscriber`: structured observability.
- `serde_json::value::RawValue` and strict schema validation layer (or `schemars` + `jsonschema` if needed).
- `deadqueue` or DB-first queue pattern (prefer DB-first this week to reduce moving parts).
- Optional later: `sqlx` migration path if async DB throughput becomes bottleneck.

## Template Strategy for Launch
Ship a narrow set of proven templates only:
- Code Fix Loop (analyze -> patch -> test -> report)
- Business Analysis Loop (intake -> research -> synthesize -> output)
- Diligence Loop (collect -> verify -> risk-score -> report)
- Personal Assistance Loop (plan day -> execute reminders -> summarize)

Each template should have:
- strict input form,
- fixed node palette,
- deterministic output artifact contract.
