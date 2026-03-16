#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODER_RES_DIR="$ROOT_DIR/src-tauri/resources/coder"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

platform_dir=""
binary_name="pi"
case "$os" in
  linux)
    if [[ "$arch" == "aarch64" || "$arch" == "arm64" ]]; then
      platform_dir="linux-aarch64"
    else
      platform_dir="linux-x86_64"
    fi
    ;;
  darwin)
    if [[ "$arch" == "arm64" || "$arch" == "aarch64" ]]; then
      platform_dir="macos-aarch64"
    else
      platform_dir="macos-x86_64"
    fi
    ;;
  mingw*|msys*|cygwin*)
    platform_dir="windows-x86_64"
    binary_name="pi.exe"
    ;;
  *)
    echo "Unsupported OS for this preflight: $os"
    exit 2
    ;;
esac

expected_bundled="$CODER_RES_DIR/$platform_dir/$binary_name"

echo "== arx coder pi preflight =="
echo "workspace: $ROOT_DIR"
echo "os/arch: $os / $arch"
echo "expected bundled binary: $expected_bundled"
echo

bundled_ok=0
if [[ -f "$expected_bundled" ]]; then
  echo "[ok] bundled file exists"
  if [[ "$os" == "linux" || "$os" == "darwin" ]]; then
    if [[ -x "$expected_bundled" ]]; then
      echo "[ok] bundled file is executable"
      bundled_ok=1
    else
      echo "[fail] bundled file is not executable (run: chmod +x \"$expected_bundled\")"
    fi
  else
    bundled_ok=1
  fi
else
  echo "[warn] bundled file missing (expected with tool-pack installs)"
fi

echo
echo "bundled summary:"
du -sh "$CODER_RES_DIR" 2>/dev/null || true
find "$CODER_RES_DIR" -maxdepth 2 -type f \( \
  -name 'pi' -o \
  -name 'pi.exe' -o \
  -name 'package.json' -o \
  -name 'PI_BINARIES_*.txt' -o \
  -name '.gitkeep' \
\) | sort || true
echo

path_ok=0
if command -v pi >/dev/null 2>&1; then
  pi_path="$(command -v pi)"
  echo "[ok] PATH has pi: $pi_path"
  set +e
  pi_version_output="$(pi --version 2>&1)"
  pi_version_exit=$?
  set -e
  echo "pi --version exit=$pi_version_exit"
  echo "$pi_version_output"
  if [[ $pi_version_exit -eq 0 ]]; then
    path_ok=1
  fi
else
  echo "[fail] PATH has no pi executable"
fi

echo
echo "npm global probe:"
set +e
npm ls -g --depth=0 @mariozechner/pi-coding-agent 2>&1
npm_probe_exit=$?
set -e
if [[ $npm_probe_exit -eq 0 ]]; then
  echo "[ok] npm reports @mariozechner/pi-coding-agent installed globally"
else
  echo "[warn] npm does not report @mariozechner/pi-coding-agent globally"
fi

echo
if [[ $bundled_ok -eq 1 || $path_ok -eq 1 ]]; then
  echo "RESULT: PASS (at least one runnable pi source detected)"
  exit 0
fi

echo "RESULT: FAIL (no runnable pi source found)"
echo "next actions:"
echo "  1) Install/enable tool pack from Settings > Tool Packs (recommended)"
echo "  2) OR install global CLI: npm install -g @mariozechner/pi-coding-agent"
exit 1
