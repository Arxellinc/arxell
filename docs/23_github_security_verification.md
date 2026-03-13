# GitHub Security Verification (Manual)

Use this quick audit in GitHub UI before public announcements and major releases.

Repository: `Arxellinc/arxell`

## 1. Branch Protection (`main`)
- [ ] Go to `Settings -> Branches -> Branch protection rules`.
- [ ] Rule targets `main`.
- [ ] `Require a pull request before merging` is enabled.
- [ ] `Require approvals` is enabled (recommended: at least 1).
- [ ] `Dismiss stale approvals when new commits are pushed` is enabled.
- [ ] `Require status checks to pass before merging` is enabled.
- [ ] Required checks include:
  - [ ] `Frontend Quality`
  - [ ] `Rust/Tauri Check`
  - [ ] `Gitleaks`
- [ ] `Require branches to be up to date before merging` is enabled.
- [ ] `Allow force pushes` is disabled.
- [ ] `Allow deletions` is disabled.

## 2. Actions Security
- [ ] Go to `Settings -> Actions -> General`.
- [ ] Actions policy is restricted to GitHub + verified creators or an approved allowlist.
- [ ] `Workflow permissions` is set to least privilege (read repository contents by default).
- [ ] `Allow GitHub Actions to create and approve pull requests` is disabled unless explicitly needed.

## 3. Repository Access
- [ ] Go to `Settings -> Collaborators and teams`.
- [ ] Write/admin access is limited to active maintainers only.
- [ ] Remove ex-collaborators and stale team grants.
- [ ] Two-factor authentication policy is enforced at org level.

## 4. Security Features
- [ ] Go to `Security -> Code security and analysis`.
- [ ] Secret scanning is enabled (if available on current plan).
- [ ] Dependabot alerts are enabled.
- [ ] Dependabot security updates are enabled.
- [ ] (Optional) Code scanning is enabled for deeper static analysis.

## 5. Rulesets (If Using Rulesets Instead of Classic Branch Rules)
- [ ] Go to `Settings -> Rules -> Rulesets`.
- [ ] Active ruleset applies to default branch.
- [ ] Ruleset enforces PR-only merges and required checks (`Frontend Quality`, `Rust/Tauri Check`, `Gitleaks`).
- [ ] Ruleset blocks force-push and deletion.

## 6. Audit Snapshot
- [ ] Add screenshot(s) of protection/ruleset pages to internal ops notes.
- [ ] Record verification date and maintainer initials in release PR.

## Sign-off
- [ ] Verified by:
- [ ] Date (UTC):
- [ ] Release/Tag:
