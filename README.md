# arx

Local-first AI desktop app built with Tauri (Rust) and React (Vite/TypeScript), with chat, coding workspace, and voice capabilities.

## Status

This project is under active development and preparing for first public open-source release. Expect breaking changes.

## Stack

- Desktop shell: Tauri v2 + Rust
- Frontend: React 18 + Vite + TypeScript
- Local persistence/runtime features in `src-tauri`

## Repository Layout

- `src/` frontend application
- `src-tauri/` Rust backend and Tauri configuration
- `scripts/` dev/build helper scripts
- `cloud/` optional cloud service components
- `vendor/` vendored dependencies used by runtime features

## Prerequisites

- Node.js 20+
- npm
- Rust stable toolchain (`rustup`)
- Tauri system dependencies

Linux packages used in CI (Ubuntu):

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  pkg-config \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev
```

## Environment

Copy local env template and fill values as needed:

```bash
cp .env.local.example .env.local
```

Current required variable:

- `VITE_CLERK_PUBLISHABLE_KEY`

Never commit secrets or real credentials.

## Local Development

Install dependencies:

```bash
npm ci
```

Run frontend only:

```bash
npm run dev
```

Run desktop app (normal):

```bash
npm run tauri dev
```

Run desktop app with safety preflight:

```bash
npm run tauri:dev:safe
```

## Build

Frontend build:

```bash
npm run build
```

Tauri build with preflight:

```bash
npm run tauri:build:safe
```

## Quality Checks

Frontend:

```bash
npm run build
```

Rust backend:

```bash
cd src-tauri
cargo check --locked
cargo test --locked --no-fail-fast
```

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow and standards.

## Community Guidelines

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Support

See [SUPPORT.md](./SUPPORT.md).

## License

Licensed under the terms in [LICENSE](./LICENSE).
