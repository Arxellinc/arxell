#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== arx safe dev restart =="
echo "[1/3] stopping stale arx app process (if any)"
pkill -f "$ROOT_DIR/src-tauri/target/debug/arx" >/dev/null 2>&1 || true

echo "[2/3] freeing dev port 1420 (if occupied)"
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti tcp:1420 || true)"
  if [[ -n "${pids}" ]]; then
    kill ${pids} >/dev/null 2>&1 || true
    sleep 1
  fi
fi

echo "[3/3] starting tauri dev"
npm run tauri dev
