# Rebuild Phase-Gate Checklist

Date: 2026-03-24  
Owner: Rebuild track

Use this checklist at the end of each rebuild phase. A phase is complete only when all required checks pass.

## Global gates (every phase)

- [ ] ADRs updated for boundary/contract changes
- [ ] Cross-platform CI checks green for impacted areas
- [ ] Observability updates included (trace/event/log changes documented)
- [ ] No `unwrap`/`expect` in non-test code
- [ ] No platform `cfg(target_os)` outside infrastructure

## Phase 1 gate: Freeze and forensics

- [ ] Legacy track is maintenance-only
- [ ] Salvage audit published
- [ ] Compatibility matrix published
- [ ] Initial ADR set accepted (`001`-`004`)

## Phase 2 gate: Domain and application skeleton

- [ ] Domain layer contains only pure types/traits/errors
- [ ] Application layer has no direct infrastructure calls
- [ ] Command/event schema v1 published
- [ ] Contract test harness present

## Phase 3 gate: Minimal vertical slice

- [ ] Send/stream/cancel/persist chat works end-to-end
- [ ] Trace IDs visible for each run
- [ ] Integration tests for chat slice pass
- [ ] Platform smoke path for core chat passes on all OSes

## Phase 4 gate: Tool runtime and Tier-1 tools

- [ ] Tool runner enforces validation/timeout/cancellation
- [ ] Tier-1 tools pass contract tests
- [ ] Tool call telemetry includes `tool_call_id`
- [ ] No tool directly mutates UI state

## Phase 5 gate: Memory v1 and bounded agent

- [ ] Retrieval path does not mutate memory
- [ ] Extraction path guarded by feature flag
- [ ] Agent loop bounds enforced (steps/tool calls/time)
- [ ] Deterministic replay artifacts available

## Phase 6 gate: Hardening and RC

- [ ] No P0/P1 open issues
- [ ] CI stable for five consecutive days
- [ ] Migration strategy documented or explicitly unsupported
- [ ] Packaging and install smoke checks pass on all OSes

## Current Status (March 24, 2026)

Phase 3 snapshot:
- [x] Send/stream/cancel/persist chat works end-to-end (backend bridge slice contract + integration coverage)
- [x] Trace IDs visible for each run in backend event flow (`correlation_id` + `run_id` contract assertions)
- [x] Integration tests for chat slice pass (`src-tauri/tests/bridge_slice_integration_tests.rs`)
- [x] Platform smoke path for core chat passes on all OSes (`scripts/ci/platform-smoke.sh` runs bridge slice integration smoke target)

Remaining gap to close Phase 3:
- None for current Phase 3 checklist scope.

Phase 4 snapshot:
- [x] Tool runner enforces validation/timeout/cancellation in application layer (`crates/application/src/tool_runtime.rs`)
- [x] Tier-1 tools pass contract tests (`help.workspace.read_file` and `help.workspace.list_dir` tests in `src-tauri/src/commands/tool_gateway.rs`)
- [x] Tool call telemetry includes `tool_call_id` (`AppEvent::ToolCallStarted` / `ToolCallFinished` assertions in tool runtime tests)
- [x] No tool directly mutates UI state (application-layer tools are contract-bound and UI-agnostic)

Remaining gap to close Phase 4:
- None for current Phase 4 checklist scope.

Phase 5 snapshot:
- [x] Retrieval path does not mutate memory (`RetrieveMemoryUseCase` reads via `MemoryRetriever` only)
- [x] Extraction path guarded by feature flag (`ExtractMemoryUseCase` + `MemoryExtractionFlag`)
- [x] Agent loop bounds enforced (step/tool/time limits in `RunBoundedAgentUseCase`)
- [x] Deterministic replay artifacts available (`AgentReplayArtifact::to_json()`)

Remaining gap to close Phase 5:
- None for current Phase 5 checklist scope.

Phase 6 snapshot:
- [ ] No P0/P1 open issues (tracked in `docs/rebuild/phase6-hardening-tracker.md`)
- [ ] CI stable for five consecutive days (evidence table in `docs/rebuild/phase6-hardening-tracker.md`)
- [x] Migration strategy documented (`docs/rebuild/migration-strategy.md`)
- [ ] Packaging and install smoke checks pass on all OSes (job `Package + Install Smoke` in `.github/workflows/rebuild-ci.yml`)

Remaining gap to close Phase 6:
- Collect five consecutive days of green rebuild CI + package/install smoke evidence.
- Confirm no P0/P1 issues remain open at RC cut.
