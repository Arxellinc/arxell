#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODER_DIR="$ROOT_DIR/src-tauri/resources/coder"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

RELEASE_TAG="${1:-}"
if [[ -z "$RELEASE_TAG" ]]; then
  RELEASE_TAG="$(
    curl -fsSL https://api.github.com/repos/badlogic/pi-mono/releases/latest \
      | node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write((d.tag_name||"").trim());'
  )"
fi

if [[ -z "$RELEASE_TAG" || "$RELEASE_TAG" == "null" ]]; then
  echo "Failed to determine pi-mono release tag"
  exit 1
fi

echo "Vendoring pi binaries from badlogic/pi-mono release: $RELEASE_TAG"

mkdir -p \
  "$CODER_DIR/linux-x86_64" \
  "$CODER_DIR/linux-aarch64" \
  "$CODER_DIR/macos-x86_64" \
  "$CODER_DIR/macos-aarch64" \
  "$CODER_DIR/windows-x86_64"

download_asset() {
  local asset_name="$1"
  local out_file="$2"
  local url="https://github.com/badlogic/pi-mono/releases/download/$RELEASE_TAG/$asset_name"
  echo "Downloading $asset_name"
  curl -fL --retry 3 --retry-delay 2 "$url" -o "$out_file"
}

extract_unix_binary() {
  local archive="$1"
  local target_dir="$2"
  local unpack_dir="$3"
  mkdir -p "$unpack_dir"
  tar -xzf "$archive" -C "$unpack_dir"
  local candidate bundle_root
  candidate="$(find "$unpack_dir" -type f -name pi -perm -u+x | head -n 1 || true)"
  if [[ -z "$candidate" ]]; then
    echo "No 'pi' binary found in $archive"
    exit 1
  fi
  bundle_root="$(dirname "$candidate")"

  find "$target_dir" -mindepth 1 ! -name '.gitkeep' -exec rm -rf {} +
  cp -a "$bundle_root"/. "$target_dir"/
  rm -rf "$target_dir/docs" "$target_dir/examples"
  rm -f "$target_dir/README.md" "$target_dir/CHANGELOG.md"
  chmod +x "$target_dir/pi"
}

extract_windows_binary() {
  local archive="$1"
  local target_dir="$2"
  local unpack_dir="$3"
  mkdir -p "$unpack_dir"
  unzip -q "$archive" -d "$unpack_dir"
  local candidate bundle_root
  candidate="$(find "$unpack_dir" -type f -iname 'pi.exe' | head -n 1 || true)"
  if [[ -z "$candidate" ]]; then
    echo "No 'pi.exe' binary found in $archive"
    exit 1
  fi
  bundle_root="$(dirname "$candidate")"

  find "$target_dir" -mindepth 1 ! -name '.gitkeep' -exec rm -rf {} +
  cp -a "$bundle_root"/. "$target_dir"/
  rm -rf "$target_dir/docs" "$target_dir/examples"
  rm -f "$target_dir/README.md" "$target_dir/CHANGELOG.md"
}

linux_x64_archive="$TMP_DIR/pi-linux-x64.tar.gz"
linux_arm64_archive="$TMP_DIR/pi-linux-arm64.tar.gz"
macos_x64_archive="$TMP_DIR/pi-darwin-x64.tar.gz"
macos_arm64_archive="$TMP_DIR/pi-darwin-arm64.tar.gz"
windows_x64_archive="$TMP_DIR/pi-windows-x64.zip"

download_asset "pi-linux-x64.tar.gz" "$linux_x64_archive"
download_asset "pi-linux-arm64.tar.gz" "$linux_arm64_archive"
download_asset "pi-darwin-x64.tar.gz" "$macos_x64_archive"
download_asset "pi-darwin-arm64.tar.gz" "$macos_arm64_archive"
download_asset "pi-windows-x64.zip" "$windows_x64_archive"

extract_unix_binary "$linux_x64_archive" "$CODER_DIR/linux-x86_64" "$TMP_DIR/unpack-linux-x64"
extract_unix_binary "$linux_arm64_archive" "$CODER_DIR/linux-aarch64" "$TMP_DIR/unpack-linux-arm64"
extract_unix_binary "$macos_x64_archive" "$CODER_DIR/macos-x86_64" "$TMP_DIR/unpack-macos-x64"
extract_unix_binary "$macos_arm64_archive" "$CODER_DIR/macos-aarch64" "$TMP_DIR/unpack-macos-arm64"
extract_windows_binary "$windows_x64_archive" "$CODER_DIR/windows-x86_64" "$TMP_DIR/unpack-windows-x64"

(
  cd "$CODER_DIR"
  sha256sum \
    linux-x86_64/pi \
    linux-aarch64/pi \
    macos-x86_64/pi \
    macos-aarch64/pi \
    windows-x86_64/pi.exe > "$ROOT_DIR/src-tauri/resources/coder/PI_BINARIES_SHA256.txt"
)

cat > "$ROOT_DIR/src-tauri/resources/coder/PI_BINARIES_VERSION.txt" <<EOF
pi-mono release: $RELEASE_TAG
vendored-at-utc: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

echo "Vendored pi binaries successfully."
echo "Version manifest: $ROOT_DIR/src-tauri/resources/coder/PI_BINARIES_VERSION.txt"
echo "Checksum manifest: $ROOT_DIR/src-tauri/resources/coder/PI_BINARIES_SHA256.txt"
