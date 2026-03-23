# Implementation Plan (Launch Week)

## Overall Strategy
Launch publicly with a stable core loop product, not maximal feature breadth.

## Day-by-Day Plan

### Day 1: Capability freeze and hardening scope
- Freeze which node types are production-supported.
- Add unsupported-node detection at run start.
- Finalize "golden path" templates and hide experimental nodes.

### Day 2: Reliability primitives
- Add workflow run cancel command.
- Add retry policy fields (attempt, max_attempts, backoff_ms).
- Persist per-node idempotency key and external operation receipt.

### Day 3: Cross-platform smoke + diagnostics
- Run OS matrix for chat/voice/flow/terminal.
- Add diagnostics export bundle.
- Fix top 3 platform blockers only.

### Day 4: Delegation contracts
- Define architect-agent cards with strict I/O contracts.
- Add template-level delegation rules in Flow metadata.
- Add fail-fast validation when delegate output schema mismatches.

### Day 5: Launch gate
- Dry-run all templates end-to-end.
- Verify launch checklist + security preflight + release artifacts.
- Publish known limitations page for transparency.

## Non-Negotiable Launch Gates
- No unsupported nodes in default templates.
- No unbounded retries.
- All side-effecting nodes idempotent or explicitly non-retryable.
- Run trace export available.
- Linux/macOS/Windows smoke tests pass on release candidate.

## Deferred (Post-launch)
- Multi-worker scale-out.
- Advanced collaboration/versioning UX.
- Broad third-party connector surface.
- Full visual template marketplace.
