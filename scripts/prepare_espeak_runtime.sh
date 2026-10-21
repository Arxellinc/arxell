#!/usr/bin/env bash
# Rebuild the bundled espeak-ng binary and English-only data on the Ubuntu
# 22.04 release baseline (glibc 2.35). Requires Docker.
set -euo pipefail

ESPEAK_TAG="${ESPEAK_TAG:-1.52.0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/src-tauri/resources/espeak-ng"
WORK_DIR="$(mktemp -d "$ROOT_DIR/.tmp-espeak-runtime.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build the Ubuntu 22.04 baseline espeak-ng binary" >&2
  exit 1
fi

echo "[espeak-runtime] cloning ${ESPEAK_TAG}"
git clone --depth 1 --branch "$ESPEAK_TAG" \
  https://github.com/espeak-ng/espeak-ng.git "$WORK_DIR/src"

echo "[espeak-runtime] building in ubuntu:22.04"
docker run --rm -v "$WORK_DIR/src:/src" -w /src ubuntu:22.04 bash -euc '
  set -euo pipefail
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential cmake python3 git >/dev/null
  cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DUSE_MBROLA=OFF \
    -DUSE_LIBSONIC=OFF \
    -DUSE_LIBPCAUDIO=OFF \
    -DUSE_ASYNC=OFF \
    -DUSE_SPEECHPLAYER=OFF >/tmp/configure.log 2>&1
  cmake --build build --parallel "$(nproc)" >/tmp/build.log 2>&1
'

DATA="$WORK_DIR/src/build/espeak-ng-data"
BINARY="$WORK_DIR/src/build/src/espeak-ng"
test -x "$BINARY"
test -f "$DATA/en_dict"

echo "[espeak-runtime] installing binary and English data"
rm -rf "$DEST/share/espeak-ng-data"
mkdir -p "$DEST/bin" "$DEST/share/espeak-ng-data/lang"
install -m 755 "$BINARY" "$DEST/bin/espeak-ng"
for file in en_dict phondata phondata-manifest phonindex phontab intonations; do
  cp "$DATA/$file" "$DEST/share/espeak-ng-data/$file"
done
cp -a "$DATA/lang/gmw" "$DEST/share/espeak-ng-data/lang/"

python3 - "$DEST/bin/espeak-ng" <<'PY'
import re
import subprocess
import sys

symbols = subprocess.check_output(["objdump", "-T", sys.argv[1]], text=True)
versions = {tuple(map(int, value.split("."))) for value in re.findall(r"GLIBC_(\d+\.\d+)", symbols)}
if not versions:
    raise SystemExit("could not determine bundled espeak-ng GLIBC requirements")
maximum = max(versions)
if maximum > (2, 35):
    raise SystemExit(
        f"espeak-ng requires GLIBC_{maximum[0]}.{maximum[1]}, newer than the Ubuntu 22.04 baseline"
    )
print(f"[espeak-runtime] max GLIBC requirement: {maximum[0]}.{maximum[1]}")
PY

output="$(ESPEAK_DATA_PATH="$DEST/share/espeak-ng-data" "$DEST/bin/espeak-ng" -q --ipa -v en-us "Hello world.")"
test -n "$output"
echo "[espeak-runtime] phonemization check: $output"
echo "[espeak-runtime] written to $DEST"
