# Rebuild Plan: Stable Cross-Platform Architecture

This plan starts on March 24, 2026 and defines a disciplined six-week rebuild for a Rust/Tauri/Tokio AI chat app with tools, memory, and agent runtime.

## Scope and constraints

- Preserve production with maintenance-only fixes in legacy code.
- Rebuild in compartmentalized layers with strict contracts.
- Enforce stability across Windows, macOS, and Linux.
- Keep changes small, test-backed, and observable.

## Branching and workspace strategy

- `legacy-maintenance`: critical fixes only, no refactors.
- `forensics`: salvage audit and architecture recovery artifacts.
- `rebuild-main`: clean rebuild track for new architecture.

## Six-week schedule

### Week 1 (March 24-30, 2026): Freeze, Forensics, Contracts

Exit criteria:
- Legacy app frozen for maintenance-only work.
- Salvage audit complete with keep/wrap/rewrite/delete/unknown status.
- Initial ADR set drafted:
  - ADR-001 layer boundaries
  - ADR-002 tool contract
  - ADR-003 event model
  - ADR-004 cancellation model
- CI skeleton present for cross-platform checks.

### Week 2 (March 31-April 6, 2026): Domain and Application Skeleton

Exit criteria:
- Domain crate contains pure types/traits/errors only.
- Application crate orchestrates use cases without direct infrastructure access.
- Typed command/event schema v1 defined.
- Contract test harness exists for adapter conformance.

### Week 3 (April 7-13, 2026): Minimal Vertical Slice

Exit criteria:
- End-to-end chat flow works: send, stream, cancel, persist.
- Single provider path integrated through interfaces.
- Trace IDs visible in logs/debug view.
- No agent and no advanced memory in this slice.

### Week 4 (April 14-20, 2026): Tool Runtime and Tier-1 Tools

Exit criteria:
- Tool runner separated from agent decision logic.
- 1-3 Tier-1 tools migrated behind strict contracts.
- Per-tool timeout, cancellation, and error mapping enforced.
- Tool contract tests pass on Windows/macOS/Linux.

### Week 5 (April 21-27, 2026): Memory V1 and Agent V1 (Bounded)

Exit criteria:
- Memory retrieval path integrated and read-only in request path.
- Extraction pipeline exists behind feature flag.
- Agent loop bounded by max steps/tool calls/duration.
- Deterministic replay artifacts available for run debugging.

### Week 6 (April 28-May 4, 2026): Hardening and Release Candidate

Exit criteria:
- Cross-platform smoke/integration suite stable.
- Data migration path documented or explicitly unsupported.
- Compatibility matrix published.
- No open P0/P1 issues.

## Mandatory engineering rules

- No `unwrap()`/`expect()` in non-test code.
- No platform `cfg(target_os)` outside infrastructure.
- No unowned async tasks; every task has cancellation path.
- No direct infrastructure access from application layer.
- No direct UI state mutation from tool code.

## Phase gates

Every phase must satisfy:
- Required tests for the phase are green.
- Observability requirements are implemented.
- ADR/docs updated for interface or boundary changes.
- Cross-platform CI checks pass for impacted paths.

## Testing model

Required layers:
- Unit: domain logic and deterministic transforms.
- Contract: trait boundary compliance (providers, tools, repositories, event payloads).
- Integration: vertical slices (chat stream/cancel, tool call path, memory retrieval).
- Platform smoke: app boot + critical path checks on all three OS targets.

## Observability requirements

- Correlation IDs:
  - `trace_id` per chat run
  - `step_id` per agent step
  - `tool_call_id` per tool invocation
- Structured logs for command start/finish/failure.
- Safe request/response summaries where policy permits.
- Debug view showing typed events in run order.

## Compatibility matrix policy

Each subsystem must be tagged as one of:
- Core portable
- Portable with adapter
- Platform-specific
- Unsupported on specific OS

Matrix changes require ADR update and CI coverage review.

## PR size and review policy

- One PR should target one contract, one adapter, or one vertical slice.
- Mixed concerns are blocked.
- Architecture-impacting changes require ADR link.
- Cross-platform failing checks block merge.

## Kill switches and feature flags

Must support runtime disablement for:
- Agent loop
- Tool runtime
- Memory extraction

If instability occurs, disable subsystem without blocking core chat.

## Deliverables index

- Rebuild execution plan: `docs/rebuild-plan.md`
- ADR template: `docs/adr/000-template.md`
- Initial ADRs: `docs/adr/001-004`
- CI skeleton: `.github/workflows/rebuild-ci.yml`

