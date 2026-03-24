# Phase 6 Status (March 24, 2026)

## Summary

Phase 6 ("Hardening and RC") is in progress.

## Completed Evidence

- Migration strategy documented:
  - `docs/rebuild/migration-strategy.md`
- Phase 6 hardening tracker established:
  - `docs/rebuild/phase6-hardening-tracker.md`
- Dedicated package/install smoke script added:
  - `scripts/ci/package-install-smoke.sh`
- Rebuild CI now includes cross-platform package/install smoke job:
  - `.github/workflows/rebuild-ci.yml` (`Package + Install Smoke`)

## Remaining to Close Phase 6

- Record five consecutive days of green CI evidence.
- Confirm no P0/P1 issues are open at RC decision time.
- Confirm package/install smoke job is green on Linux, macOS, and Windows in CI history.
