#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== arx security preflight =="
echo "workspace: $ROOT_DIR"
echo

tracked_regex='(^|/)\.env($|\.|/)|\.pem$|\.key$|\.p12$|\.pfx$|\.jks$|\.keystore$|id_rsa$|id_ed25519$|(^|/)\.envrc($|\.)|(^|/)\.npmrc$'

echo "Checking first-party tracked files for sensitive filename patterns..."
tracked_hits="$(
  git ls-files \
    | rg -v '^(vendor/)' \
    | rg -n "$tracked_regex" \
    | rg -v '\.example$' \
    || true
)"
if [[ -n "$tracked_hits" ]]; then
  echo "[fail] Tracked files match sensitive patterns:"
  echo "$tracked_hits"
  echo
  echo "Move secrets to local env files and update .gitignore before release."
  exit 1
fi
echo "[ok] No tracked secret-like filenames detected"
echo

echo "Checking ignore coverage for common local secret files..."
check_paths=(
  ".env.local"
  ".env.production"
  ".envrc"
  ".npmrc"
  "cloud/premium-api/.env"
  "cloud/sync-signal/.env"
)

not_ignored=0
for path in "${check_paths[@]}"; do
  if git check-ignore -q --no-index "$path"; then
    echo "[ok] ignored: $path"
  else
    echo "[fail] not ignored: $path"
    not_ignored=1
  fi
done

if [[ $not_ignored -ne 0 ]]; then
  echo
  echo "Add missing ignore rules before publishing."
  exit 1
fi

echo
echo "Optional secret scanners:"
if command -v gitleaks >/dev/null 2>&1; then
  echo "  gitleaks detect --source . --verbose"
else
  echo "  gitleaks not installed locally (CI still runs gitleaks on push/PR)."
fi

echo
echo "RESULT: PASS"
