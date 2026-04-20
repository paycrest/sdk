#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_go.sh <version> [--dry-run|--publish]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE_ARG="${2:---dry-run}"

# shellcheck source=common.sh
source "$ROOT/scripts/release/common.sh"
MODE="$(release_mode_from_arg "$MODE_ARG")"

ensure_clean_worktree "$ROOT"
require_semver "$VERSION"
maybe_run_smoke_suite "$ROOT"
require_cmd go1.26.0

log_release_mode "Go SDK" "$VERSION" "$MODE"

cd "$ROOT/sdks/go"
go1.26.0 test ./...

cat <<EOF
Go SDK release validated: $VERSION
Next step in sdk-go repository:
  git tag v$VERSION
  git push origin v$VERSION
EOF

if [[ "$MODE" == "dry-run" ]]; then
    echo "Dry run complete for Go release."
fi
