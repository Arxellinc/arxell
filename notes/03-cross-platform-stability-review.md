# Cross-Platform Stability Review (Linux, macOS, Windows)

## Priority 0 (Do Before Public Launch)

1. Align Flow node catalog with runtime capability
- Hide or label unsupported/disabled nodes in production UI.
- Block run start if graph contains unsupported node types.
- Reason: prevents silent runtime failures and protects trust.

2. Add deterministic retry and idempotency contract
- Every side-effecting node should define an idempotency key strategy.
- Persist per-node attempt metadata and last external operation key.
- Reason: long-duration loops will otherwise duplicate writes/emails/transactions.

3. Harden filesystem/process boundaries for node actions
- Constrain `util.read_write_file` to workspace-scoped allowlists by default.
- Require explicit elevated mode for non-workspace paths.
- Reason: platform differences in path rules/permissions amplify production risk.

4. Formalize run cancellation behavior
- Add explicit cancel command for workflow runs and cancellation propagation to active node operations.
- Reason: long tasks must be interruptible and recoverable.

## Linux-specific
- Current Linux STT path uses `prctl(PR_SET_PDEATHSIG)` for daemon cleanup, good baseline.
- Add watchdog + health ping for persistent Python STT process to avoid stale pipes.
- Validate distro variance for `python3`, audio backends, WebKitGTK runtime dependency notes.

## macOS-specific
- Ensure microphone and speech permissions are clearly surfaced on first use.
- Validate app-signing/notarization implications for spawned helper binaries/scripts.
- Test file dialog + sandboxed path behavior with iCloud/Downloads/Documents.

## Windows-specific
- Confirm Python executable fallback and path quoting in all voice/runtime script invocations.
- Validate long path and UNC path handling in workspace and file nodes.
- Confirm terminal/session behavior with shell differences and CRLF edge cases.

## Observability upgrades needed now
- Add stable `run_id`, `node_id`, `attempt`, `duration_ms`, `error_class` in one unified log schema.
- Add startup health panel checks:
  - STT engine availability
  - TTS availability
  - model endpoint reachability
  - writable dirs
- Add one-click export of latest diagnostic bundle.

## Test matrix to run this week
- OS matrix: Ubuntu LTS, macOS 14+, Windows 11.
- Scenarios:
  - Chat stream/cancel/regenerate.
  - Voice start/stop/barge-in/restart after STT error.
  - Flow run success + failure + timeout + malformed node params.
  - Terminal session lifecycle.
  - Model serve load/unload and fallback to API.
