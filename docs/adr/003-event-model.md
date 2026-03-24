# ADR-003: Typed Command and Event Model

- Status: Accepted
- Date: 2026-03-24
- Deciders: Core desktop team
- Related: docs/rebuild-plan.md

## Context

Stringly-typed event flows made backend/frontend synchronization fragile and hard to debug.

## Decision

Use typed commands and events with explicit versioning:

- Commands include: `SendMessage`, `CancelRun`, `LoadConversation`, `SaveSettings`, `InvokeToolPreview`.
- Events include: `ChatStarted`, `TokenReceived`, `ToolCallStarted`, `ToolCallFinished`, `MemoryRetrieved`, `ErrorOccurred`.

Events must include correlation metadata where applicable:
- `trace_id`
- `step_id`
- `tool_call_id`

## Options considered

1. Continue string event names with dynamic payloads.
2. Typed command/event schema with versioning (chosen).
3. Full internal event-sourcing architecture.

## Rationale

Option 2 provides compile-time confidence and predictable frontend state transitions without introducing event-store complexity.

## Consequences

- Positive: safer refactoring, better debuggability, clearer contracts.
- Negative: schema evolution requires discipline.
- Operational: versioning policy and compatibility checks needed.

## Implementation notes

- Required interfaces/contracts: command handlers and event serializer.
- Migration steps: add adapters translating legacy events during transition.
- Feature flags: optional legacy event bridge.
- Test plan: serialization/deserialization contract tests and integration traces.

## Rollback plan

Fallback to legacy event bridge while preserving typed model for new features.

