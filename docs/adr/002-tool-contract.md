# ADR-002: Tool Contract and Execution Model

- Status: Accepted
- Date: 2026-03-24
- Deciders: Core desktop team
- Related: docs/rebuild-plan.md

## Context

Tool implementations previously relied on hidden dependencies and shared mutable state, which caused regressions and nondeterministic behavior.

## Decision

Every tool must implement a uniform contract:

- Metadata: `id`, `version`, `description`
- Typed input/output schema
- Declared capability requirements
- Timeout and cancellation requirements
- Side-effect policy declaration
- Execution API: `execute(context, input) -> output`

Tool execution is owned by a dedicated tool runner that validates input, enforces limits, records telemetry, and returns typed results/errors.

## Options considered

1. Keep ad hoc async tool functions.
2. Uniform typed tool contract with runner (chosen).
3. Out-of-process tool execution for all tools.

## Rationale

Option 2 provides strong isolation and testability while keeping implementation overhead manageable for incremental migration.

## Consequences

- Positive: deterministic behavior, contract tests, safer migration.
- Negative: migration overhead for existing tools.
- Operational: permission and side-effect policy must be maintained.

## Implementation notes

- Required interfaces/contracts: `Tool`, `ToolRunner`, `ToolRegistry`.
- Migration steps: old tools first wrapped, then rewritten selectively.
- Feature flags: per-tool enable/disable.
- Test plan: per-tool unit + contract + cross-platform smoke.

## Rollback plan

Disable unstable tools via registry feature flags; keep chat core functional.

