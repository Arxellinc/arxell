# ADR-001: Layer Boundaries and Ownership

- Status: Accepted
- Date: 2026-03-24
- Deciders: Core desktop team
- Related: docs/rebuild-plan.md

## Context

Prior architecture drift allowed business logic, platform branching, and side effects to spread across layers, causing cross-platform regressions and difficult debugging.

## Decision

Adopt strict layered ownership:

- `crates/domain`: pure types, traits, errors. No I/O, no Tauri.
- `crates/application`: orchestration only. No direct I/O.
- `crates/infrastructure`: adapters, persistence, providers, OS and Tauri integration.
- `crates/tools`: tool implementations behind contracts.
- `crates/memory`: extraction/store/retrieval logic behind contracts.
- `crates/agent`: bounded decision loop only.
- `apps/desktop`: shell/frontend only.

## Options considered

1. Keep existing mixed architecture and refactor in place.
2. Layered architecture with contract boundaries (chosen).
3. Microservice split for all subsystems.

## Rationale

Option 2 maximizes testability and replacement safety while keeping runtime and operational complexity reasonable for desktop delivery.

## Consequences

- Positive: clearer ownership, lower coupling, better portability.
- Negative: up-front contract and adapter effort.
- Operational: stricter code review and CI enforcement required.

## Implementation notes

- Required interfaces/contracts: provider, tool, memory, repository, event bus.
- Migration steps: salvage via wrappers before full rewrites where possible.
- Feature flags: agent, tool runtime, memory extraction.
- Test plan: unit + contract + integration + platform smoke.

## Rollback plan

If instability appears, disable non-core subsystems with feature flags and fall back to minimal chat slice.

