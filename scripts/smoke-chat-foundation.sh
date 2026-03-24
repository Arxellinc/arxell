#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_DIR="$ROOT_DIR/src-tauri"

echo "[smoke] rust check"
(cd "$RUST_DIR" && cargo check >/dev/null)

echo "[smoke] tauri feature check"
(cd "$RUST_DIR" && cargo check --features tauri-runtime >/dev/null)

echo "[smoke] stream event trace"
TMP_OUT="$(mktemp)"
TMP_LOG="$(mktemp)"
(cd "$RUST_DIR" && FOUNDATION_CONVERSATION_LOG_PATH="$TMP_LOG" cargo run --quiet >"$TMP_OUT" 2>&1)

grep -Fq "action=chat.stream.start" "$TMP_OUT"
grep -Fq "action=chat.stream.chunk" "$TMP_OUT"
grep -Fq "action=chat.stream.complete" "$TMP_OUT"
grep -Fq "corr=demo-001" "$TMP_OUT"

echo "[smoke] persistence trace"
grep -Fq '"role":"user"' "$TMP_LOG"
grep -Fq '"role":"assistant"' "$TMP_LOG"

rm -f "$TMP_OUT"
rm -f "$TMP_LOG"

echo "[smoke] PASS"
