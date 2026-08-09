#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != linux* ]]; then
  echo "[install] This installer currently supports Linux only."
  exit 0
fi

if [[ ! -r /etc/os-release ]]; then
  echo "[install] Cannot detect Linux distribution (/etc/os-release missing)." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release

case "${ID:-}" in
  ubuntu|debian|linuxmint|pop|zorin|elementary)
    echo "[install] Detected ${PRETTY_NAME:-$ID}. Installing local build dependencies..."
    sudo apt-get update
    sudo apt-get install -y \
      pkg-config \
      libasound2-dev \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libjavascriptcoregtk-4.1-dev \
      libsoup-3.0-dev \
      libgdk-pixbuf-2.0-dev \
      libcairo2-dev \
      libpango1.0-dev \
      libglib2.0-dev \
      libatk1.0-dev
    echo "[install] Linux dependency install complete."
    ;;
  *)
    echo "[install] Unsupported distro for automatic install: ${PRETTY_NAME:-${ID:-unknown}}" >&2
    echo "[install] Please install GTK/WebKit dev dependencies for your distro, then run:" >&2
    echo "[install]   ./scripts/check-linux-deps.sh" >&2
    exit 1
    ;;
esac
