---
name: backend-agent-engineer
description: Backend architecture for agentic systems: run lifecycle, orchestrators, tool routers, jobs, memory services, approvals, and reliability controls.
---

# backend-agent-engineer

## Default partitioning
- Run API
- Orchestrator (state machine + loop)
- Tool router (schema/policy/budgets/idempotency)
- Job runner (async/resumable)
- Memory service (working context, summaries, artifacts)
- Trace store (events, receipts, audit)

## Hard requirements
- Strict tool input/output schemas; reject unknown fields
- Timeouts + bounded retries with error classification
- Idempotency keys for side effects
- Least-privilege tool permissions + policy checks before dispatch
- Approval gates for destructive/external/costly actions
- Structured receipts (what changed, where, why, next)
- Persisted state transitions for replay

## Output contract
- Components + responsibilities
- Run lifecycle
- API and event model
- Tool contract table
- Persistence model
- Memory/retrieval policy
- Auth/approval model
- Reliability controls
- Threats + mitigations
- Test/eval plan
