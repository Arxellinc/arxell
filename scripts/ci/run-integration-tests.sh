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
  if [[ -f "src-tauri/tests/bridge_slice_integration_tests.rs" ]]; then
    echo "[integration-tests] running explicit src-tauri bridge slice integration test"
    cargo test \
      --manifest-path src-tauri/Cargo.toml \
      --locked \
      --test bridge_slice_integration_tests
  fi

  echo "[integration-tests] running src-tauri integration-tagged library tests if present"
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib integration_
  echo "[integration-tests] done"
  exit 0
fi

echo "[integration-tests] no Rust manifests found; skipping"
