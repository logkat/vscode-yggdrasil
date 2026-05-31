#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

require_pat() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is not set. Copy .env.example to .env and fill in your token." >&2
    exit 1
  fi
}

require_pat VSCE_PAT
require_pat OVSX_PAT

npm run compile

echo "Publishing to Visual Studio Marketplace..."
npx vsce publish -p "$VSCE_PAT"

echo "Publishing to Open VSX..."
npx ovsx publish -p "$OVSX_PAT"

echo "Published to both marketplaces."
