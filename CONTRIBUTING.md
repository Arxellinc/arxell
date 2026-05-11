# Contributing to Arxell

Thank you for your interest in contributing to Arxell.

This document explains the development workflow, branch policy, pull request process, release process, and expectations for contributors.

## Development Principles

Arxell uses a simple development model:

- `main` is the primary development branch.
- `main` should always build, pass tests, and remain suitable for release.
- All changes enter through pull requests.
- Stable releases are published as versioned Git tags.
- Release branches are created only when older versions need maintenance.

The goal is to keep the project reliable without creating unnecessary process overhead.

## Branching Model

### `main`

`main` is the default branch and the source of truth for active development.

It is protected and should always remain in a releasable state. Direct pushes to `main` are not allowed. All changes must be reviewed and merged through pull requests.

### Short-Lived Contributor Branches

Create a short-lived branch from the latest `main` for each change.

Recommended branch prefixes:

```text
feature/my-new-feature
fix/my-bug-fix
docs/update-readme
refactor/simplify-parser
test/add-api-tests
ci/update-workflow
```

Delete the branch after the pull request is merged.

### Release Tags

Stable releases are tagged on `main`:

```text
v0.2.10
v0.3.0
v1.0.0
```

Tags trigger the CI build pipeline and produce release artifacts.

### Maintenance Branches (rare)

If a patch is needed for an older release that is no longer the latest, create a short-lived maintenance branch:

```text
release/v0.2.x
```

These branches exist only to backport critical fixes. They are deleted once the patch release is published.

## Pull Request Process

1. **Create a branch** from `main`.
2. **Make your changes.** Keep the scope focused. One PR should address one concern.
3. **Verify the build.** Run `cd frontend && npm run build && npm run lint` before pushing. If there are Rust changes, run `cd src-tauri && cargo check`.
4. **Open a pull request** against `main`.
5. **Describe the change.** Include:
   - What changed and why.
   - How to test it.
   - Any relevant issue references.
6. **Request a review.** A maintainer will review, request changes, or approve.
7. **Address feedback.** Push additional commits to the same branch.
8. **Squash merge.** Once approved, the PR is squash-merged into `main` with a descriptive commit message.

### PR Expectations

- The branch builds and lints cleanly.
- No secrets, API keys, or credentials in the diff.
- No telemetry, analytics, or tracking code.
- Changes are scoped to the stated purpose.
- New features include documentation updates if applicable.

## Release Process

1. Ensure `main` is in a releasable state.
2. Update the version in `src-tauri/Cargo.toml`.
3. Run `node scripts/version-sync.mjs` to sync the version across `tauri.conf.json`, `package.json`, and `package-lock.json`.
4. Commit the version bump with a message like `Release v0.3.0`.
5. Tag the commit: `git tag v0.3.0`.
6. Push the tag: `git push origin v0.3.0`.
7. The CI pipeline builds platform artifacts and publishes a GitHub Release.

## Code Style

- **Rust:** Follow `rustfmt` defaults. Run `cargo fmt` before committing.
- **TypeScript:** The project uses its own conventions. Follow existing patterns in the codebase.
- **CSS:** Use CSS variables defined in `styles.css`. Never hardcode colors or font sizes. See `AGENTS.md` for the full variable reference.
- **Comments:** Only add comments when they explain *why*, not *what*.

## Development Setup

### Prerequisites

- Node.js (LTS)
- Rust toolchain (stable)
- Tauri CLI v2

### Getting Started

```bash
# Install frontend dependencies
cd frontend && npm install

# Start the dev server
npm run dev

# Build for production
npm run build

# Check Rust compilation
cd src-tauri && cargo check
```

### Useful Commands

| Command | Purpose |
|---------|---------|
| `cd frontend && npm run dev` | Start dev server |
| `cd frontend && npm run build` | Production build |
| `cd frontend && npm run lint` | TypeScript check |
| `cd src-tauri && cargo check` | Rust compilation check |
| `cd src-tauri && cargo fmt` | Format Rust code |
| `node scripts/version-sync.mjs` | Sync version across config files |
| `node scripts/version-sync.mjs --check` | Verify version sync without changes |

## Questions

If anything in this document is unclear, open an issue with the label `question` or ask in the pull request discussion.
