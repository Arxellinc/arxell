# Simplification and Community Contribution Plan

## Principle
Simplify the public surface so external developers can contribute safely without deep internal context.

## Simplifications to Make Immediately

1. Single source of truth for node support
- Generate node palette from runtime-supported registry.
- Remove duplicated definitions between UI constants and backend match arms.

2. Tighten tool mode defaults
- Keep default mode sandbox everywhere.
- Require explicit elevation path for shell/root in UI and logs.

3. Reduce feature ambiguity in naming
- Clarify distinction:
  - `project/agents` (event-sourced delegation view)
  - `flow` (workflow authoring/execution)
  - `tasks` (user-level task tracking)

4. Stabilize extension interfaces
- Publish versioned schema for:
  - workflow JSON,
  - node metadata,
  - run trace events,
  - tool-invoke request/response envelopes.

## Contributor Experience Upgrades
- Add `CONTRIBUTING` section for Flow node authoring with minimal checklist.
- Add contract tests for each built-in node family.
- Add fixture-based replay tests for workflow runs.
- Provide one "good first issue" path per subsystem:
  - UI node metadata,
  - backend node execution,
  - diagnostics/logging,
  - docs/examples.

## Governance for Public Week
- Mark unstable APIs as `experimental` explicitly.
- Use labels: `flow-core`, `platform-windows`, `platform-macos`, `platform-linux`, `good-first-issue`.
- Keep weekly roadmap short and visible.
