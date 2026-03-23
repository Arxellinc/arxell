# Final Comprehensive Flow Plan

## 0. Ground Truth (Already Implemented)
1. Flow already has a working DAG runtime with topological ordering and cycle detection.
2. Run/node execution records and trace events already exist.
3. Flow canvas already has top square `agent_*` ports, bottom binding ports, autosave, import/export, and inspector JSON views.
4. This plan focuses on wiring and hardening, not rebuilding the editor from scratch.

## 1. Purpose
Build a production-grade Flow system that supports:
1. A reliable, observable Ralph Loop template for long-duration autonomous work.
2. Open-ended custom workflows ("infinite" workflow variety) with strong guardrails.
3. Intelligent multi-model delegation from `agent` nodes to local/external models configured in the API panel.
4. A specialist architect/manager agent that can inspect workflow architecture and guide users on required inputs, expected outputs, and intermediate process design.
5. Operator-level run controls in the Flow header for runtime, budget, and safety limits.

## 2. Product Goals
1. Deliver one stable default template (`Coding Ralph Loop`) that users can trust immediately.
2. Preserve flexibility for advanced users to build custom workflows without destabilizing defaults.
3. Make run state and reasoning observable at all times (status, decisions, retries, handoffs, outputs).
4. Keep cross-platform behavior predictable on Linux, macOS, and Windows.

## 3. Core Principles
1. Harden existing runtime; avoid full rewrites before launch.
2. Safe by default; advanced power available via explicit opt-in.
3. Deterministic execution contracts for side effects and retries.
4. UI must never imply capability that runtime cannot execute.
5. Delegation decisions must be explainable and inspectable.

## 4. Architecture Direction

### 4.1 Runtime model
Use current A2A workflow runtime as base and extend with:
1. Run control: `cancel`, `pause`, `resume`.
2. Retry policies and attempt tracking per node.
3. Checkpointing and resumable state.
4. Parent-child lineage for delegated sub-runs.

### 4.2 Workflow modes
1. `Template Mode` (default): locked templates, strict schemas, safer node set.
2. `Custom Mode` (advanced): full builder with capability preflight and warnings.

### 4.3 Observability model
Every run exposes:
1. Timeline of node attempts.
2. Structured statuses and durations.
3. Delegation and model-routing decisions.
4. Artifacts and outputs.

## 5. Agent Node Top Square Connectors (Delegation Feature)

## 5.1 Connector semantics
Use top square connectors on `agent` nodes as delegation links to other agent/model nodes.

Connector roles:
1. `agent_1`: primary delegation path.
2. `agent_2`: optional reviewer/escalation path.
3. `agent_3`: optional fallback/specialist path.

Each top-connector edge defines:
1. `delegation_intent` (`plan`, `implement`, `review`, `research`, `validate`, etc.).
2. `routing_policy` (`auto`, `pinned`, `fallback_only`).
3. `input_contract` and `output_contract` references.
4. `budget` limits (`max_turns`, `max_cost`, `max_latency_ms`).

## 5.2 Runtime behavior
When an `agent` node executes:
1. It evaluates whether delegation is needed.
2. If yes, it selects one or more linked delegation targets from top connectors.
3. It spawns child runs with explicit contracts and budgets.
4. It waits/gathers based on node policy (`wait_all`, `wait_any`, `fire_and_collect`).
5. It synthesizes child outputs into its own output schema.

## 5.3 Delegation targets
Targets can map to:
1. Local model-backed agent profiles.
2. External API model-backed profiles.
3. Hybrid profiles (prefer local, failover to API).

Model availability is sourced from API panel model registry (existing model configuration data).

## 5.4 Model provider nodes
Add explicit config nodes for model routing:
1. `model.local`: local loaded runtime model.
2. `model.api`: specific API panel model config.
3. `model.auto`: runtime chooses based on policy and budgets.

These nodes are declaration/config nodes and connect into agent top ports; they do not execute business logic themselves.

## 6. Multi-Model Routing Policy (How agent knows when delegation matters)

## 6.1 Decision engine inputs
Delegation and model-routing decisions must consider:
1. Task complexity score (prompt length, number of required outputs, uncertainty signals).
2. Required capability tags (coding, reasoning depth, retrieval breadth, cost sensitivity).
3. Output strictness (must satisfy schema vs freeform).
4. Current node SLA budget (latency/cost/turn limits).
5. Live model health and availability (from model/API state).

## 6.2 Decision policy
Default policy for `agent` node:
1. Try local model first for low/medium complexity bounded tasks.
2. Delegate to stronger specialist/API model when:
- schema-critical output is failing,
- repeated retries exceed threshold,
- reasoning depth exceeds configured limit,
- explicit connector intent requires specialist.
3. Use reviewer connector when confidence drops below threshold.
4. Record every routing/delegation decision in trace (`decision_reason`).

## 6.4 Acceptance modes for agent completion
Support these completion gates on agent nodes:
1. `self_eval`
2. `schema_valid`
3. `test_pass`
4. `evaluator_grade` (single-turn evaluator model via `agent_2`)
5. `manual_gate`
6. `any_of` (composite)

## 6.3 Explainability requirement
Every delegation event logs:
1. `why_delegated` (rule match).
2. `chosen_target` (connector + model/profile).
3. `alternatives_considered` (optional).
4. `budget_used` vs `budget_remaining`.

## 7. Specialist Architect/Manager Agent (Flow Review Assistant)

## 7.1 UX
Add a small collapsible panel in bottom-right of Flow panel:
1. Collapsed chip: `Flow Architect`.
2. Expanded popup shows:
- mandatory inputs,
- expected outputs,
- process gaps,
- contract mismatches,
- optimization/simplification suggestions.

## 7.2 Functional responsibilities
The architect/manager agent can:
1. Analyze current workflow graph and node params.
2. Generate "Required Input Spec".
3. Generate "Expected Output Spec".
4. Highlight missing credentials, weak contracts, unsupported nodes.
5. Recommend stage decomposition and delegation wiring.
6. Offer one-click fixes where deterministic.

## 7.3 Guardrails
1. Review mode is advisory by default.
2. Any structural change requires explicit user confirm.
3. Suggestions include confidence + impact/risk labels.

## 7.4 Panel tabs and behavior
The bottom-right popup has three tabs:
1. `Analyze`: plain-English workflow summary + mandatory inputs + desired outputs + stage walkthrough.
2. `Validate`: structural and contract checks; blocking errors prevent run start.
3. `Suggest`: actionable improvements with optional one-click apply.

`Validate` must also run automatically as part of run preflight.

## 8. Template Strategy

## 8.1 Launch template (mandatory)
`Coding Ralph Loop` with fixed stages:
1. Architect
2. Implementer
3. Tester
4. Reviewer

Each stage defines:
1. mandatory input schema,
2. mandatory output schema,
3. retry/backoff policy,
4. delegation permissions.

## 8.2 Expansion templates
After launch:
1. Business Analysis Loop
2. Due Diligence Loop
3. Personal Assistant Loop
4. Research Loop

## 8.3 Custom workflow support
1. Blank workflow starter.
2. Contract wizard to define required inputs/outputs.
3. Optional "auto-wire" suggestions from architect popup.

## 9. Flow Panel Functional Scope

## 9.1 Must-have UI
1. Supported-node library from backend registry.
2. Run preflight validator before execution.
3. Run controls (`cancel`, `pause`, `resume`, `retry failed`).
4. Timeline with attempts, durations, errors, delegation events.
5. Template picker with stable vs advanced labels.
6. Bottom-right Flow Architect popup.
7. Top header controls for run limits and budget policy.

## 9.3 Top header controls (required)
Expose the following controls in the Flow panel header for every run:
1. `Max Runtime` (minutes): hard wall clock cutoff for full run.
2. `Budget Cap` (USD or credits): maximum aggregate model/tool spend.
3. `Max Turns` (global): cap across all delegated and parent agent turns.
4. `Max Parallel Agents`: upper bound for concurrent delegated agents.
5. `Retry Policy`: global default (`attempts`, `backoff`, `jitter` on/off).
6. `Model Routing Mode`: `local-first`, `api-first`, `hybrid`.
7. `Safety Mode`: `strict` (block on schema mismatch) or `guided` (allow override).
8. `Auto-Approve Gates`: `off`, `on`, or `timeout`.
9. `Confidence Floor`: low-confidence threshold to trigger reevaluate/delegate behavior.

These values become part of run metadata and are inherited by nodes unless a node sets a stricter local limit.

## 9.2 Must-have backend
1. Supported-node registry endpoint.
2. Preflight command endpoint.
3. Run control commands.
4. Checkpoint + resume persistence.
5. Retry/attempt execution engine updates.
6. Delegation lineage and child-run orchestration.

## 10. Data and Contracts

## 10.1 Required persisted fields
1. Node attempts with retry metadata.
2. Idempotency keys for side-effecting operations.
3. Decision logs for delegation/routing.
4. Parent-child run references.
5. Checkpoint snapshots.

## 10.2 Contract enforcement
1. Validate stage output against declared schema.
2. Block handoff on contract mismatch unless explicit override.
3. Surface mismatch details in timeline and architect popup.

## 10.3 Node support tiers (catalog governance)
Keep a backend-owned node registry with tiering:
1. `Tier 1 (stable)`: visible by default, allowed in production templates.
2. `Tier 2 (beta)`: visible with beta labeling and warnings.
3. `Tier 3 (hidden/unsupported)`: not shown by default; execution blocked.

Flow palette must render from backend registry to prevent UI/runtime drift.

## 11. Reliability and Safety
1. Fail-fast on unsupported nodes in production mode.
2. Bounded retries only.
3. Side effects must be idempotent or non-retryable.
4. Explicit cancel propagation to active operations.
5. Deterministic resume from latest checkpoint.

## 11.1 Run state machine (minimum)
Use explicit run states:
1. `draft`
2. `validating`
3. `ready`
4. `running`
5. `waiting_user` / `waiting_external`
6. `retrying`
7. `paused`
8. `canceling` -> `canceled`
9. `succeeded` / `failed` / `timed_out` / `budget_exceeded`

## 12. Cross-Platform Hardening (Flow-relevant only)
1. Startup progress visibility during heavy bootstrap.
2. Voice capability state messaging (so loop demos fail gracefully).
3. Windows managed-process PID safety verification.
4. Local model/server health probe and recovery prompt.

## 13. Implementation Plan

## Phase 1 (Ralph Loop v1)
1. Supported-node registry + capability-aware palette.
2. Run preflight validation.
3. Run controls and bounded retries.
4. Timeline observability.
5. Ship `Coding Ralph Loop` template.
6. Add top header run-limit controls wired to runtime enforcement.

## Phase 2 (Delegation Intelligence)
1. Top-connector delegation contracts for `agent` node.
2. Multi-model routing policy using API panel model availability.
3. Parent-child run lineage and decision trace.

## Phase 3 (Architect Assistant + Scale)
1. Bottom-right collapsible Flow Architect popup.
2. Contract advisor + gap detection + fix suggestions.
3. Additional templates and custom template tooling.

## 14. Acceptance Criteria
1. User can run `Coding Ralph Loop` end-to-end with clear stage visibility.
2. `Agent` node can delegate through top square connectors to configured model-backed specialists.
3. Delegation decisions are logged with explainable reasons.
4. Workflow can be paused/resumed and recovered after restart.
5. Architect popup accurately reports required inputs, desired outputs, and process gaps.
6. Unsupported or unsafe workflow definitions are blocked with actionable errors.

## 15. Definition of Done for Public Release
1. Ralph Loop template is stable on Linux/macOS/Windows smoke matrix.
2. Flow panel observability is complete enough for debugging failed runs.
3. Delegation to API-panel models works with local/API/hybrid routing.
4. Documentation covers template usage, delegation wiring, and known limitations.
5. Top header limit controls are enforced in runtime (not just cosmetic UI).

## 16. Functional Ralph Loop Template (Reference Spec)

This is the default production template to ship.

### 16.1 Template name
`coding_ralph_loop_v1`

### 16.2 Stage graph
1. `architect_manager` (plans + validates scope/contracts)
2. `implementer` (applies changes/artifacts)
3. `tester` (verifies behavior and quality gates)
4. `reviewer` (final decision and summary)

Flow:
`architect_manager -> implementer -> tester -> reviewer`

Escalation/fallback:
`implementer -> architect_manager` (on repeated contract failure)
`tester -> implementer` (on fix-required loops within bounded retries)

### 16.3 Stage contracts
1. `architect_manager` output must include:
- mandatory inputs list,
- desired outputs list,
- implementation plan steps,
- delegation guidance (`when_to_delegate`, `preferred_specialist`).
2. `implementer` output must include:
- artifact manifest,
- change summary,
- unresolved blockers.
3. `tester` output must include:
- checks executed,
- pass/fail status,
- required remediations.
4. `reviewer` output must include:
- release recommendation (`approve`/`reject`),
- final rationale,
- residual risks.

### 16.4 Default runtime parameters (header defaults)
1. `max_runtime_minutes`: `90`
2. `budget_cap_usd`: `25`
3. `max_total_turns`: `80`
4. `max_parallel_agents`: `3`
5. `retry_attempts_default`: `2`
6. `retry_backoff_ms_default`: `3000`
7. `routing_mode`: `hybrid`
8. `safety_mode`: `strict`

### 16.5 Delegation rules for top connectors on `agent` nodes
1. `agent_1` (`primary`): use for normal specialist delegation.
2. `agent_2` (`review`): use when confidence drops or quality gate fails.
3. `agent_3` (`fallback`): use on timeout/cost overrun/model unavailability.

Delegation trigger examples:
1. schema mismatch after first attempt -> delegate to `agent_2`.
2. complexity score above threshold + strict output requirement -> delegate to specialist on `agent_1`.
3. target model unavailable or budget risk -> route using `agent_3` fallback policy.

### 16.6 Runtime enforcement checklist
1. Stop run when wall-clock exceeds `max_runtime_minutes`.
2. Stop or degrade mode when budget cap is reached.
3. Deny new child-agent spawn when `max_parallel_agents` reached.
4. Block stage handoff on mandatory schema failure in `strict` mode.
5. Emit decision trace for every delegation and routing action.
