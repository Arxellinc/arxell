---
name: evals-ops-and-guardrails
description: Making an agent system shippable: eval suites, adversarial testing, observability, budgets, policy gates, rollout, and rollback criteria.
---

# evals-ops-and-guardrails

## Minimum production controls
- Tool schemas (strict validation)
- Budgets (time/steps/cost) + stop on breach
- Timeouts + bounded retries + error classification
- Idempotency for side effects
- Approval gates for risky actions
- Structured receipts + trace logs
- Replay capability
- Golden + adversarial + regression evals

## Evals
### Golden-path evals
Define representative tasks with:
- scenario + starting context
- allowed tools
- expected outcome
- pass criteria
- max cost/latency

### Adversarial evals (required)
- prompt injection (policy override attempts)
- malicious retrieval content
- tool misuse (wrong tool, unsafe args, overly broad scope)
- data exfil attempts (secrets/tenant boundaries)
- hallucinated claims without evidence
- approval bypass attempts
- runaway loop or budget exhaustion

### Regression
Run on prompt/tool/runtime/model/memory changes. Gate releases on safety regressions.

## Observability
Log run and step traces:
- state transitions
- tool calls (validated + redacted args) and results (structured)
- retries + error types
- approvals (requested/approved/denied)
- latency + cost estimates
- final disposition

## Release and rollout
Stage: sandbox → dogfood → canary → expand → full.
Define gating metrics, rollback triggers, and incident owner.

## Output contract
- Capability surface
- Golden + adversarial eval plans
- Metrics + thresholds
- Logging/tracing spec
- Release gates + rollback criteria
