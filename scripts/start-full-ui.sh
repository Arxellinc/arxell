#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
TAURI_DIR="$ROOT_DIR/src-tauri"

kill_stale_instances() {
  local patterns=(
    "target/debug/app-foundation"
    "cargo run --features tauri-runtime"
    "$HOME/.local/share/com.refactor.ai/llama-runtime/.*/llama-server"
    "$HOME/.local/share/com.refactor.ai/llama-runtime/.*/llama-server.exe"
    "$ROOT_DIR/.*/vite"
    "$ROOT_DIR/frontend.*vite"
    "$ROOT_DIR/frontend.*npm run dev"
  )

  for pattern in "${patterns[@]}"; do
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      echo "[cleanup] stopping stale process: $pattern"
      pkill -f "$pattern" || true
    fi
  done
}

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${TAURI_PID:-}" ]] && kill -0 "$TAURI_PID" 2>/dev/null; then
    kill "$TAURI_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

kill_stale_instances

echo "[start] frontend: npm run dev"
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo "[start] tauri: cargo run --features tauri-runtime"
cd "$TAURI_DIR"
cargo run --features tauri-runtime &
TAURI_PID=$!
wait "$TAURI_PID"
