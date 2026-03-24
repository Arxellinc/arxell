#!/usr/bin/env bash
set -euo pipefail

echo "[contract-tests] starting"

ran_any=0

if [[ -f "src-tauri/Cargo.toml" ]]; then
  echo "[contract-tests] running explicit src-tauri bridge contract suite"
  cargo test \
    --manifest-path src-tauri/Cargo.toml \
    --locked \
    commands::bridge::tests
  ran_any=1
fi

if [[ -f "crates/domain/Cargo.toml" ]]; then
  echo "[contract-tests] running domain crate contract-tagged tests"
  cargo test --manifest-path crates/domain/Cargo.toml --locked contract_
  ran_any=1
fi

if [[ -f "crates/application/Cargo.toml" ]]; then
  echo "[contract-tests] running application crate contract-tagged tests"
  cargo test --manifest-path crates/application/Cargo.toml --locked contract_
  ran_any=1
fi

if [[ "${ran_any}" -eq 0 ]]; then
  echo "[contract-tests] no contract targets found; skipping"
  exit 0
fi

echo "[contract-tests] done"
