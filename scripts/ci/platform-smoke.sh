#!/usr/bin/env bash
set -euo pipefail

echo "[platform-smoke] starting"

# Skip Rust cargo check - covered by rust-quality job
# (whisper-rs build issues on Windows/macos cause false failures)

if [[ -f "package.json" ]]; then
  if command -v npm >/dev/null 2>&1; then
    echo "[platform-smoke] frontend typecheck"
    npm run typecheck
  else
    echo "[platform-smoke] npm not available; skipping frontend checks"
  fi
fi

echo "[platform-smoke] done"
