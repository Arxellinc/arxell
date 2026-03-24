#!/usr/bin/env bash
set -euo pipefail

echo "[platform-smoke] starting"

if [[ -f "src-tauri/Cargo.toml" ]]; then
  echo "[platform-smoke] cargo check (src-tauri)"
  cargo check --manifest-path src-tauri/Cargo.toml --locked
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

