#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != linux* ]]; then
  echo "[appimage] Runtime check applies to Linux only."
  exit 0
fi

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "[appimage] Missing required tool: pkg-config" >&2
  exit 1
fi

required_runtime_pkgs=(
  gtk+-3.0
  webkit2gtk-4.1
  javascriptcoregtk-4.1
  libsoup-3.0
)

missing=()
for pkg in "${required_runtime_pkgs[@]}"; do
  if ! pkg-config --exists "$pkg"; then
    missing+=("$pkg")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "[appimage] Missing Linux runtime libraries required by AppImage:" >&2
  for pkg in "${missing[@]}"; do
    echo "  - $pkg" >&2
  done
  echo >&2
  echo "[appimage] Ubuntu/Debian runtime fix:" >&2
  echo "  sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libjavascriptcoregtk-4.1-0 libsoup-3.0-0" >&2
  exit 1
fi

echo "[appimage] Runtime dependency check passed"
