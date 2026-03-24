#!/usr/bin/env bash
set -euo pipefail

echo "[package-install-smoke] starting"

if [[ -f "package.json" ]]; then
  if command -v npm >/dev/null 2>&1; then
    if [[ ! -d "node_modules" ]]; then
      echo "[package-install-smoke] installing frontend dependencies (npm ci)"
      npm ci
    fi
    echo "[package-install-smoke] frontend production build"
    npm run build
  else
    echo "[package-install-smoke] npm not available; failing"
    exit 1
  fi
fi

if [[ -f "src-tauri/Cargo.toml" ]]; then
  echo "[package-install-smoke] cargo check (src-tauri)"
  cargo check --manifest-path src-tauri/Cargo.toml --locked

  if [[ "${ARX_SMOKE_SKIP_TAURI_BUILD:-0}" == "1" ]]; then
    echo "[package-install-smoke] skipping tauri build smoke (ARX_SMOKE_SKIP_TAURI_BUILD=1)"
  elif [[ -f "package.json" ]]; then
    echo "[package-install-smoke] tauri build smoke (--debug --no-bundle)"
    npm run tauri build -- --debug --no-bundle
  fi
fi

echo "[package-install-smoke] done"
