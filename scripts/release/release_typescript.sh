#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_typescript.sh <version> [--dry-run|--publish]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${2:-}"

# shellcheck source=common.sh
source "$ROOT/scripts/release/common.sh"
MODE="$(release_mode_from_arg "$MODE")"
require_semver "$VERSION"
ensure_clean_worktree "$ROOT"
require_cmd node
require_cmd npm
ensure_file "$ROOT/sdks/typescript/package.json"
maybe_run_smoke_suite "$ROOT"

cd "$SDK_DIR"
SDK_DIR="$ROOT/sdks/typescript"
cd "$SDK_DIR"
current_version="$(node -p "require('./package.json').version")"
assert_version_match "$VERSION" "$current_version" "sdks/typescript/package.json version"
log_release_mode "@paycrest/sdk" "$VERSION" "$MODE"
confirm_publish_if_needed "@paycrest/sdk" "$VERSION" "$MODE"
npm ci --no-fund --no-audit
npm run test

npm pack >/dev/null
if [[ "$MODE" == "dry-run" ]]; then
    echo "TypeScript package pack validation completed for $VERSION."
    exit 0
fi

npm publish --access public

echo "TypeScript SDK published: $VERSION"
