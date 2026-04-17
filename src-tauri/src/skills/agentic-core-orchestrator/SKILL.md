---
name: agentic-core-orchestrator
description: Agent architecture, control loops, tool contracts, memory, approvals, evals/observability.
---

# agentic-core-orchestrator

## Prime directives
1. Outcome-first; produce explicit artifacts.
2. Plan/Act separation; gate side effects.
3. Assume prompt injection + tool misuse threats.
4. Enforce budgets (time/steps/cost) and stop conditions.

## Default build loop
- Frame mission: goal, non-goals, constraints, risk tier, acceptance gates.
- Choose topology: default single agent + tools; escalate only with clear reason.
- Define contracts: state schema, tool I/O, memory policy, approvals.
- Implement controls: typed I/O, idempotency, timeouts/retries, audit trail, receipts.
- Add eval+ops: golden + adversarial + regression, tracing and replay.

## Output format (architecture)
- System overview
- Topology
- State
- Tools (table)
- Memory
- Approvals
- Evals + thresholds

## Stop conditions
Require explicit confirmation for destructive/external/costly actions or data export.
