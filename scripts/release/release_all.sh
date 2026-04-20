#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_all.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE_ARG="${2:---dry-run}"

# shellcheck source=common.sh
source "$ROOT/scripts/release/common.sh"

MODE="$(release_mode_from_arg "$MODE_ARG")"
require_semver "$VERSION"
ensure_clean_worktree "$ROOT"
require_cmd git
log_release_mode "all SDKs" "$VERSION" "$MODE"

if [[ "$MODE" == "publish" ]]; then
    echo "Release mode is publish. This will attempt to publish artifacts."
    echo "Type 'release $VERSION' to continue:"
    read -r confirmation
    if [[ "$confirmation" != "release $VERSION" ]]; then
        echo "Confirmation mismatch, aborting." >&2
        exit 1
    fi
else
    echo "release_all: running in dry-run mode"
fi

"$ROOT/scripts/release/release_typescript.sh" "$VERSION" "$MODE_ARG"
"$ROOT/scripts/release/release_python.sh" "$VERSION" "$MODE_ARG"
"$ROOT/scripts/release/release_go.sh" "$VERSION" "$MODE_ARG"
"$ROOT/scripts/release/release_rust.sh" "$VERSION" "$MODE_ARG"
"$ROOT/scripts/release/release_laravel.sh" "$VERSION" "$MODE_ARG"

echo "All release flows completed for $VERSION"
