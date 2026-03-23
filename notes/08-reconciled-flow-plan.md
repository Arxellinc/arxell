# Reconciled Flow Plan (Merged Review)

## Outcome
This plan reconciles the `todo/` review with the existing `notes/` analysis and defines a final implementation path for the Flow panel to support:
- one production-grade, observable Ralph Loop template, and
- a scalable path to many custom/infinite workflows.

## Reconciliation Summary

### Strong points from `todo/` to keep
1. Borrow Ralph orchestrator patterns, do not depend on it directly.
2. Introduce durable orchestration semantics (pause/resume/retry/checkpoint).
3. Build supervisor-worker delegation (primary agent spawning specialist agents).
4. Improve first-run and platform reliability (startup progress, voice capability degradation messaging).
5. Raise typed IPC quality (`specta`/`tauri-specta`) and structured errors.

### Points to reject/correct from `todo/`
1. "A2A workflow has no topo sort/dependency execution" is incorrect.
- Current code already topologically sorts and executes node DAG order with cycle detection.

2. "Workflow runs are just shallow DB entries with no execution" is incorrect.
- Current runtime executes many node types (`llm.query`, transforms, HTTP, memory, sqlite/postgres/redis/email).

3. "Enable WAL mode" is already done.
- Both `arx.db` and `a2a.db` initialize with `PRAGMA journal_mode=WAL`.

4. "Build a new DAG engine" is unnecessary for this launch.
- Existing engine should be hardened and extended instead of replaced.

5. "Collapse all manifests to JSON" is low-value now.
- Not required for Ralph Loop functionality and risks churn before launch.

## Final Architecture Direction

### Core decision
Evolve existing `a2a_workflow` runtime into a durable loop runtime; do not replace it.

### Runtime layers
1. Flow definition layer (existing): workflow/nodes/edges/templates.
2. Loop execution layer (new hardening): retries, cancel, checkpoint, resume, idempotency metadata.
3. Delegation layer (new): specialist sub-agent node contract and parent/child run lineage.
4. Observability layer (expanded): normalized run/node/attempt events with UI timeline.

### Product contract
- "Template mode": locked, safe, production templates.
- "Custom mode": user-authored workflows with guardrails and capability validation.

## Ralph Loop v1 (Production Template)

### Ship one canonical template first
`Coding Ralph Loop`:
- Stage 1: Architect plan
- Stage 2: Implement
- Stage 3: Test/verify
- Stage 4: Review/summarize

### Template guarantees
- fixed stage schema,
- bounded retries/timeouts per stage,
- strict stage output schema validation,
- full trace visibility and artifact list.

### Why this first
- easiest to measure correctness,
- strongest user value for launch,
- most reusable loop primitives for other templates.

## Flow Panel Product Changes

1. Capability-aware node palette
- UI must only show production-supported node types by default.
- Unsupported/experimental nodes are hidden or visibly labeled.

2. Run readiness validator
- Before run start, validate unsupported nodes, missing credentials, invalid params, and cyclic graph.

3. Observability surface
- Add run timeline + per-node attempt rows + last error class + elapsed durations.
- Add filter tabs: `Active`, `Failed`, `Succeeded`.

4. Template UX
- New template picker with:
  - `Coding Ralph Loop` (stable)
  - `Blank Custom Workflow` (advanced)

5. Run controls
- Add explicit `Cancel`, `Pause`, `Resume`, `Retry Failed Node` actions.

## Backend Implementation Plan

### Phase A: Stabilize existing engine (no major rewrites)
1. Add `cancel/pause/resume` command surface for workflow runs.
2. Add per-node retry policy fields and attempt tracking.
3. Add idempotency metadata fields for side-effecting nodes.
4. Add checkpoint snapshot table for resumable runs.

### Phase B: Delegation primitives
1. Add an `ai.delegate`/`agent.spawn` style node with bounded config.
2. Persist parent-child run lineage.
3. Add output contract validation between stages.

### Phase C: Observability hardening
1. Normalize observability events: `run_id`, `node_id`, `attempt`, `status`, `duration_ms`, `error_class`.
2. Expose event query command for Flow panel timeline.
3. Add trace export (JSON) for support/debug.

## Cross-Platform Scope for Flow Work

Keep only items directly impacting Flow-loop reliability this cycle:
1. Startup progress visibility (user trust).
2. Voice capability state messaging (avoid invisible failures during loop demos).
3. Windows PID safety check around managed runtime process.
4. Local-server health probe with recovery prompt.

Defer broader platform cleanup not blocking Flow-loop launch.

## Final Prioritized TODO List

## P0 (must complete for Ralph Loop v1)
1. Enforce runtime-supported node registry in Flow panel.
2. Implement run preflight validation (unsupported node, bad params, missing credentials).
3. Add run control commands: cancel, pause, resume.
4. Add per-node retry policy (`max_attempts`, `backoff_ms`) and persisted attempts.
5. Add Flow run timeline UI (node attempts + status + duration + errors).
6. Ship `Coding Ralph Loop` template with strict stage contracts.

## P1 (high-value next)
1. Add delegation node for specialist sub-agent execution with bounded tool/mode policy.
2. Add checkpoint/resume table + restore logic.
3. Add run trace export + diagnostics bundle hook.
4. Add structured error envelope across Flow commands.
5. Add typed IPC generation for Flow command/event payloads.

## P2 (post-launch expansion toward infinite workflows)
1. Add template compiler (template -> executable workflow with schema checks).
2. Add more templates: research, diligence, personal assistant.
3. Add custom template authoring helpers and contract testing harness.
4. Add policy packs (safe defaults per domain) to preserve stability as workflow variety grows.

## Definition of Done (Ralph Loop v1)
1. A user can create and run `Coding Ralph Loop` end-to-end from Flow panel.
2. User can observe each stage live with clear status and timings.
3. Run survives restart or can be resumed from checkpoint.
4. Failed stages can be retried with bounded policy.
5. Unsupported workflows fail fast with actionable errors.
