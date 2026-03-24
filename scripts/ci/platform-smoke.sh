#!/usr/bin/env bash
set -euo pipefail

echo "[platform-smoke] starting"

if [[ -f "src-tauri/Cargo.toml" ]]; then
  echo "[platform-smoke] cargo check (src-tauri)"
  cargo check --manifest-path src-tauri/Cargo.toml --locked

  if [[ -f "src-tauri/tests/bridge_slice_integration_tests.rs" ]]; then
    echo "[platform-smoke] bridge slice integration smoke test"
    cargo test \
      --manifest-path src-tauri/Cargo.toml \
      --locked \
      --test bridge_slice_integration_tests
  else
    echo "[platform-smoke] bridge slice integration test not found; skipping"
  fi
fi

if [[ -f "package.json" ]]; then
  if command -v npm >/dev/null 2>&1; then
    echo "[platform-smoke] frontend typecheck"
    npm run typecheck
  else
    echo "[platform-smoke] npm not available; skipping frontend checks"
  fi
fi

echo "[platform-smoke] done"
