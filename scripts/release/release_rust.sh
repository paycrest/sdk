#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_rust.sh <version> [--dry-run|--publish]}"
MODE_ARG="${2:---dry-run}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK_DIR="$ROOT/sdks/rust"

# shellcheck source=common.sh
source "$ROOT/scripts/release/common.sh"

MODE="$(release_mode_from_arg "$MODE_ARG")"
require_semver "$VERSION"
ensure_clean_worktree "$ROOT" "release_rust"
require_cmd cargo
verify_manifest_version "$SDK_DIR/Cargo.toml" "^version = \"$VERSION\"$"
log_release_mode "Rust SDK" "$VERSION" "$MODE"

maybe_run_smoke_suite "$ROOT"
confirm_publish_if_needed "Rust SDK" "$VERSION" "$MODE"

cd "$SDK_DIR"
cargo package

if [[ "$MODE" == "dry-run" ]]; then
    echo "Rust package build verified for $VERSION (publish skipped)"
    exit 0
fi

cargo publish --locked

echo "Rust SDK published: $VERSION"
