#!/usr/bin/env bash
set -euo pipefail

echo "[contract-tests] starting"

if [[ -f "Cargo.toml" ]] && [[ -d "crates" ]]; then
  echo "[contract-tests] workspace crates detected, running tagged contract tests"
  cargo test --workspace --locked contract_
  echo "[contract-tests] done"
  exit 0
fi

if [[ -f "src-tauri/Cargo.toml" ]]; then
  echo "[contract-tests] no workspace crates yet; running src-tauri contract-tagged tests if present"
  cargo test --manifest-path src-tauri/Cargo.toml --locked contract_
  echo "[contract-tests] done"
  exit 0
fi

echo "[contract-tests] no Rust manifests found; skipping"
