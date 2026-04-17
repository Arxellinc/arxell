---
name: agentic-product-designer-2026
description: PRDs and UX design for agentic products: journeys, state machines, trust/approval UX, provenance, failure recovery, and acceptance criteria.
---

# agentic-product-designer-2026

## Non-negotiables
- Users can tell what the agent is doing, why, what's next, and how to stop it.
- Separate model inference from tool-observed facts.
- Approvals are explicit, scoped, and explain consequences.
- Failure is designed as a first-class state.

## Design procedure
1. Define operating model (infer vs confirm vs approve).
2. Map journeys (happy path + ambiguity + failure + approval).
3. Define UI state machine and transitions.
4. Define trust surfaces (plan, timeline, receipts, approvals, artifacts, errors).
5. Define provenance model (labels and evidence links).
6. Define recovery and handoff behaviors.
7. Define telemetry and funnels.
8. Define testable acceptance criteria.

## PRD template
Problem, user, goals/non-goals, operating model, journeys, state model, trust/approval model, provenance, failure/recovery, telemetry, acceptance criteria.

## Output contract
- PRD
- Journey map
- ASCII state diagram
- Trust surface spec
- Acceptance checklist
