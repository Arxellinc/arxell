#!/usr/bin/env bash
set -euo pipefail

echo "== arx low-memory tauri build =="

# Keep UI responsive while compiling on constrained systems.
NICE_BIN=""
IONICE_BIN=""
if command -v nice >/dev/null 2>&1; then
  NICE_BIN="nice -n 10"
fi
if command -v ionice >/dev/null 2>&1; then
  IONICE_BIN="ionice -c3"
fi

# Conservative defaults; caller can override.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS="${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-16}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

echo "CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS"
echo "CARGO_INCREMENTAL=$CARGO_INCREMENTAL"
echo "CARGO_PROFILE_RELEASE_CODEGEN_UNITS=$CARGO_PROFILE_RELEASE_CODEGEN_UNITS"
echo "NODE_OPTIONS=$NODE_OPTIONS"

echo "[1/2] building frontend"
eval "$NICE_BIN $IONICE_BIN npm run build"

echo "[2/2] building tauri bundle"
eval "$NICE_BIN $IONICE_BIN npm run tauri build"

echo "Low-memory build finished."
