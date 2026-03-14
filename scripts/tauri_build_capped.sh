#!/usr/bin/env bash
set -euo pipefail

echo "== arx capped tauri build =="

# Default cap: enough headroom for desktop usage while protecting the host.
MEMORY_MAX="${ARX_BUILD_MEMORY_MAX:-22G}"
MEMORY_HIGH="${ARX_BUILD_MEMORY_HIGH:-20G}"
JOBS="${ARX_BUILD_JOBS:-2}"
NODE_HEAP_MB="${ARX_BUILD_NODE_HEAP_MB:-3072}"

BUILD_CMD="
  export CARGO_BUILD_JOBS='${JOBS}';
  export CARGO_INCREMENTAL=0;
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=8;
  export NODE_OPTIONS='--max-old-space-size=${NODE_HEAP_MB}';
  export RUSTFLAGS='-C link-arg=-Wl,--no-keep-memory -C link-arg=-Wl,--reduce-memory-overheads';
  npm run tauri:build:safe
"

echo "memory max:  ${MEMORY_MAX}"
echo "memory high: ${MEMORY_HIGH}"
echo "jobs:        ${JOBS}"
echo "node heap:   ${NODE_HEAP_MB} MB"

if command -v systemd-run >/dev/null 2>&1; then
  echo "Using systemd cgroup memory cap."
  exec systemd-run --user --scope \
    -p "MemoryHigh=${MEMORY_HIGH}" \
    -p "MemoryMax=${MEMORY_MAX}" \
    -p "OOMPolicy=kill" \
    /bin/bash -lc "${BUILD_CMD}"
fi

echo "systemd-run not found; running uncapped fallback."
exec /bin/bash -lc "${BUILD_CMD}"
