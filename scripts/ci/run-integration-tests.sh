#!/usr/bin/env bash
set -euo pipefail

echo "[integration-tests] starting"

if [[ -f "Cargo.toml" ]] && [[ -d "crates" ]]; then
  echo "[integration-tests] workspace crates detected, running integration-tagged tests"
  cargo test --workspace --locked integration_
  echo "[integration-tests] done"
  exit 0
fi

if [[ -f "src-tauri/Cargo.toml" ]]; then
  echo "[integration-tests] running src-tauri integration-tagged tests if present"
  cargo test --manifest-path src-tauri/Cargo.toml --locked integration_
  echo "[integration-tests] done"
  exit 0
fi

echo "[integration-tests] no Rust manifests found; skipping"

