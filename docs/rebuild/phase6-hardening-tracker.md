# Phase 6 Hardening Tracker

Date: 2026-03-24  
Owner: Rebuild track

Use this file as the source of truth for Phase 6 gate evidence.

## Severity Definitions

- `P0`: data loss, security critical, or app unusable on supported platform.
- `P1`: major user-facing regression with no reasonable workaround.

## Open P0/P1 Issues

Current status: no P0/P1 issues recorded in this tracker yet.  
Note: this is a tracking file, not an automated issue export.

| ID | Severity | Summary | Status | Owner | Linked evidence |
|---|---|---|---|---|---|
| _none_ | - | - | - | - | - |

## CI Stability Evidence (5-day window)

Record one line per day after all required rebuild checks are green.

| Date (UTC) | Rebuild CI | Platform Smoke | Package+Install Smoke | Notes |
|---|---|---|---|---|
| 2026-03-24 | configured | configured | configured | Added dedicated package/install smoke job in `rebuild-ci.yml` |
| 2026-03-24 | local-check | local-check | local-check (linux) | Ran `scripts/ci/package-install-smoke.sh` locally with `ARX_SMOKE_SKIP_TAURI_BUILD=1` |

## Gate Decision

- [ ] No P0/P1 open issues
- [ ] CI stable for five consecutive days
- [x] Migration strategy documented or explicitly unsupported (`docs/rebuild/migration-strategy.md`)
- [ ] Packaging/install smoke checks passing on Linux/macOS/Windows (await CI evidence)
