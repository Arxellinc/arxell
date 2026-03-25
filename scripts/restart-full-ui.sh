#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

kill_running_ui() {
  local patterns=(
    "$ROOT_DIR/scripts/start-full-ui.sh"
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
      echo "[restart] stopping running process: $pattern"
      pkill -f "$pattern" || true
    fi
  done
}

kill_running_ui
sleep 1

echo "[restart] starting a fresh UI session"
exec "$ROOT_DIR/scripts/start-full-ui.sh"
