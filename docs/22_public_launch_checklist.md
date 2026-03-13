# Public Launch Checklist

Use this checklist before announcing the public repository.

## 1. Secret Hygiene
- [ ] Run `npm run security:preflight` and confirm `RESULT: PASS`.
- [ ] Run full-history secret scan locally (recommended): `gitleaks detect --source . --verbose`.
- [ ] Confirm no real credentials exist in tracked files, examples, docs, or screenshots.
- [ ] Ensure local secret files stay untracked: `.env*` (except examples), `.envrc*`, `.npmrc`, key/cert files.
- [ ] Rotate any key/token that may have ever appeared in commits, logs, CI, or screenshots.

## 2. Repository Safety Controls
- [ ] Verify `Secret Scan` workflow is enabled in GitHub Actions.
- [ ] Enable branch protection for `main`:
  - [ ] Require pull request before merge.
  - [ ] Require status checks to pass (`ci`, `gitleaks`).
  - [ ] Restrict force-push and branch deletion.
- [ ] Confirm only intended maintainers/admins have write access.
- [ ] Verify SECURITY.md points to a monitored security contact path.

## 3. Build and Test Readiness
- [ ] Run `npm ci`.
- [ ] Run `npm run build`.
- [ ] Run Rust checks:
  - [ ] `cd src-tauri && cargo check --locked`
  - [ ] `cd src-tauri && cargo test --locked --no-fail-fast`
- [ ] Run `npm run tauri:dev:safe` for a local smoke test.
- [ ] Confirm platform-specific runtime prerequisites are documented and accurate.

## 4. Open-Source Readiness
- [ ] Verify `LICENSE` is final and matches intended distribution.
- [ ] Confirm `README.md` quick start works from a clean clone.
- [ ] Confirm `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, and `SECURITY.md` are complete.
- [ ] Remove internal-only references (private hostnames, internal project IDs, staff-only runbooks).
- [ ] Validate that sample configs use placeholders only.

## 5. Release Mechanics
- [ ] Freeze merge window for launch branch.
- [ ] Prepare release notes in `docs/15_release_notes.md`.
- [ ] Tag launch commit (`vX.Y.Z`) and create GitHub Release notes.
- [ ] Verify CI passes on the exact tagged commit.
- [ ] Perform final install/run smoke test from the tagged release artifact.

## 6. Announcement Readiness
- [ ] Prepare announcement copy (what it is, who it is for, known limitations).
- [ ] Include clear support and issue-reporting paths.
- [ ] Publish roadmap/known gaps to set expectation for early adopters.
- [ ] Assign maintainers for first 24-72h triage window after announcement.

## Go/No-Go Gate
- [ ] All sections above complete.
- [ ] Final maintainer sign-off recorded in PR/release discussion.
