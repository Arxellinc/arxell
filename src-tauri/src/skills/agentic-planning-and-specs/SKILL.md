---
name: agentic-planning-and-specs
description: Scoping agentic work, producing contract-first specs, decomposing execution phases, and defining verifiable done criteria.
---

# agentic-planning-and-specs

## Planning rules
- Surface assumptions and unknowns up front.
- Define interfaces and contracts before implementation.
- Keep decomposition shallow (5–12 steps) and verifiable.
- Include functional, safety, UX, cost, and latency gates.

## Standard spec pack (default output)
1. Scope (goal, non-goals, user, constraints, risk tier)
2. Assumptions + unknowns
3. Topology decision (+ alternatives considered)
4. State schema
5. Tool contracts
6. Memory/retrieval policy
7. Threat model
8. Eval plan (golden + adversarial + regression + thresholds)
9. Implementation phases (risk retired early)
10. Done criteria checklist

## Done criteria checklist
- Scope and non-goals are explicit
- Topology choice is justified against simpler options
- Tool/state contracts are concrete
- Golden/adversarial evals defined
- Each phase has a verification method
- Cost/latency expectations stated
