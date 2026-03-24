# ADR-004: Async Ownership and Cancellation

- Status: Accepted
- Date: 2026-03-24
- Deciders: Core desktop team
- Related: docs/rebuild-plan.md

## Context

Untracked async tasks and unclear ownership caused leaked work, race conditions, and platform-specific instability.

## Decision

Adopt strict async ownership:

- Every spawned task has an owner.
- Every long-running task has explicit cancellation path.
- No detached background work for user-scoped runs.
- Timeout budgets enforced per operation class.
- Request-scoped tasks cannot outlive request unless explicitly backgrounded.

## Options considered

1. Keep ad hoc tokio spawning and cancellation.
2. Enforce owner+cancellation model with timeouts (chosen).
3. Single-threaded serial execution for all workflows.

## Rationale

Option 2 preserves concurrency where needed but adds reliability and debuggability required for agent/tool systems.

## Consequences

- Positive: fewer leaks/races; easier incident analysis.
- Negative: more plumbing for task ownership.
- Operational: telemetry must include timeout/cancel outcomes.

## Implementation notes

- Required interfaces/contracts: `RunHandle`, `CancellationToken`, run registry.
- Migration steps: wrap legacy spawns, then replace with owned tasks.
- Feature flags: optional disable background extraction.
- Test plan: cancellation integration tests and timeout behavior tests.

## Rollback plan

Disable nonessential async pipelines (agent/extraction) while preserving chat core and persistence.

