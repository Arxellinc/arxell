# Contributing to arx

Thanks for contributing. Keep changes small, reviewable, and well-tested.

## Getting Started

1. Fork the repo and create a feature branch from `main`.
2. Set up the project locally:
```bash
npm ci
cp .env.local.example .env.local
```
3. Run the app:
```bash
npm run tauri dev
```

## Development Standards

- Prefer focused PRs with one primary goal.
- Keep commit messages clear and descriptive.
- Do not include secrets, credentials, or private keys.
- Update docs when behavior or workflows change.

## Before Opening a PR

Run the same checks expected by CI:

```bash
npm run build
cd src-tauri
cargo check --locked
cargo test --locked --no-fail-fast
```

If your change affects Tauri/runtime behavior, include platform notes in the PR description.

## Pull Request Checklist

- [ ] Scope is limited and intentional
- [ ] Build/test checks pass locally
- [ ] Relevant docs updated
- [ ] No secrets or sensitive data included

## Reporting Bugs

Open an issue with:

- What you expected
- What happened
- Steps to reproduce
- OS/version and relevant logs

## Code of Conduct

By participating, you agree to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
