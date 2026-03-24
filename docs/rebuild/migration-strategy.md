# Rebuild Migration Strategy

Date: 2026-03-24  
Owner: Rebuild track

## Scope

This strategy covers migration from legacy runtime architecture to rebuild contracts (`domain`, `application`, Tauri adapters) while keeping core chat functionality available.

## Policy

- Migration is incremental and contract-first.
- Legacy behavior is wrapped before rewritten where feasible.
- If a subsystem cannot be migrated safely in-phase, it is explicitly marked unsupported for the rebuild release candidate.

## Data Compatibility Stance

- **Chat/message persistence:** best-effort compatibility via existing SQLite schema and adapter wrappers.
- **Tool runtime state:** no compatibility guarantee for in-flight tool sessions across versions.
- **Agent bounded-loop replay artifacts:** new format; no backward-compatibility guarantee with pre-rebuild traces.
- **Memory extraction artifacts:** guarded behind feature flag and considered opt-in until post-RC hardening.

## Cutover Steps

1. Keep legacy track maintenance-only; no broad refactors.
2. Land rebuild contracts and vertical slices behind tests.
3. Migrate tool and memory paths to contract use cases.
4. Enable bounded agent loop with explicit limits and replay output.
5. Validate cross-platform smoke + package/install smoke on Linux/macOS/Windows.
6. Release candidate cut only after Phase 6 gates pass.

## Rollback

- Disable unstable subsystems via flags/kill switches:
  - agent loop
  - tool runtime
  - memory extraction
- Maintain core chat send/stream/cancel/persist path as minimum viable fallback.

## Explicit Unsupported Cases (RC)

- Resuming old in-flight tool sessions after upgrading between incompatible runner contracts.
- Replaying legacy non-contract traces as deterministic rebuild replay artifacts.
