#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
TAURI_DIR="$ROOT_DIR/src-tauri"

kill_stale_instances() {
  local patterns=(
    "target/debug/arxell-lite"
    "cargo run --features tauri-runtime"
    "$HOME/.local/share/com.arxell.lite/llama-runtime/.*/llama-server"
    "$HOME/.local/share/com.arxell.lite/llama-runtime/.*/llama-server.exe"
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

wait_for_frontend() {
  local max_tries=40
  local try=1
  while (( try <= max_tries )); do
    if curl -sSf "http://127.0.0.1:5173" >/dev/null 2>&1; then
      echo "[start] frontend is ready at http://127.0.0.1:5173"
      return 0
    fi
    sleep 0.25
    ((try++))
  done

  echo "[start] frontend did not become ready on http://127.0.0.1:5173" >&2
  return 1
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

echo "[start] frontend: npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
(cd "$FRONTEND_DIR" && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort) &
FRONTEND_PID=$!

wait_for_frontend

echo "[start] tauri: cargo run --features tauri-runtime"
cd "$TAURI_DIR"
cargo run --features tauri-runtime &
TAURI_PID=$!
wait "$TAURI_PID"
