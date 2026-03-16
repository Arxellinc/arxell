#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag>"
  exit 1
fi

VERSION="${TAG#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version tag: '$TAG'"
  exit 1
fi

# Normalize numeric identifiers so tags like v0.9.02 become semver-valid 0.9.2.
CORE="${VERSION%%[-+]*}"
SUFFIX="${VERSION#$CORE}"
IFS='.' read -r MAJOR MINOR PATCH <<<"$CORE"
MAJOR="$((10#$MAJOR))"
MINOR="$((10#$MINOR))"
PATCH="$((10#$PATCH))"
VERSION="${MAJOR}.${MINOR}.${PATCH}${SUFFIX}"

export ARX_VERSION="$VERSION"

echo "Syncing project version to: $ARX_VERSION (from tag: $TAG)"

node <<'NODE'
const fs = require('fs');

function patchJson(path) {
  const v = process.env.ARX_VERSION;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  data.version = v;
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${path} -> version ${v}`);
}

patchJson('package.json');
patchJson('src-tauri/tauri.conf.json');
NODE

perl -0777 -i -pe 's/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/$1$ENV{ARX_VERSION}$2/m' src-tauri/Cargo.toml

echo "Updated src-tauri/Cargo.toml -> version $ARX_VERSION"
