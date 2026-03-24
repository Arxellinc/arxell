#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
TAURI_DIR="$ROOT_DIR/src-tauri"

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[start] frontend: npm run dev"
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo "[start] tauri: cargo run --features tauri-runtime"
cd "$TAURI_DIR"
cargo run --features tauri-runtime
