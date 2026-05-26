#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != linux* ]]; then
  exit 0
fi

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "[deps] Missing required tool: pkg-config" >&2
  echo "[deps] Install it, then retry." >&2
  echo "[deps] Ubuntu/Debian: sudo apt-get install -y pkg-config" >&2
  exit 1
fi

required_pkgs=(
  gtk+-3.0
  webkit2gtk-4.1
  javascriptcoregtk-4.1
  libsoup-3.0
  gdk-pixbuf-2.0
  pango
  cairo
  gobject-2.0
  glib-2.0
  atk
)

missing=()
for pkg in "${required_pkgs[@]}"; do
  if ! pkg-config --exists "$pkg"; then
    missing+=("$pkg")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "[deps] Missing Linux development libraries required for local Tauri builds:" >&2
  for pkg in "${missing[@]}"; do
    echo "  - $pkg" >&2
  done
  echo >&2
  echo "[deps] Install required packages and retry." >&2
  echo "[deps] Automatic installer (Ubuntu/Debian):" >&2
  echo "  ./scripts/install.sh" >&2
  echo >&2
  echo "[deps] Ubuntu/Debian example:" >&2
  echo "  sudo apt-get update && sudo apt-get install -y pkg-config libasound2-dev libwebkit2gtk-4.1-dev libgtk-3-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libgdk-pixbuf-2.0-dev libcairo2-dev libpango1.0-dev libglib2.0-dev libatk1.0-dev" >&2
  exit 1
fi

echo "[deps] Linux dependency preflight passed"
