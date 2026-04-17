---
name: frontend-agent-experience
description: Frontend UX for agentic apps: plan/timeline/receipt surfaces, approvals, provenance, streaming state, and recovery UX.
---

# frontend-agent-experience

## Principles
- Separate conversation from execution (timeline is system of record).
- Make progress semantic (planning/executing/waiting/approvals/retrying).
- Receipts and provenance build trust.
- Control is a feature (edit plan, pause/cancel, retry safely).

## Required UI model
Represent runs as a state machine:
`idle`, `drafting`, `planning`, `executing`, `waiting_for_user_input`, `waiting_for_approval`, `retrying`, `completed`, `failed-recoverable`, `failed-terminal`.

Maintain separate stores:
- transcript/intent
- run state
- event timeline
- artifacts
- pending approvals

## Required surfaces
- Composer
- Plan view (editable when appropriate)
- Timeline view (events)
- Receipt cards (tool, redacted inputs, outputs, what changed, links to artifacts/diffs)
- Approval UI (scope, consequences, approve/deny/edit)
- Artifact panel (previews/diffs/outputs)

## Streaming rules
- Treat backend output as events.
- Rendering must be idempotent under duplicates/delay.
- Survive refresh/reconnect for long runs.

## Output contract
- Journey + failure path
- UI state model
- Component model
- Event schema
- Approval + receipt UX
- Recovery UX
- Accessibility checklist
