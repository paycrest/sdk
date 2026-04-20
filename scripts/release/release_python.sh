#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_python.sh <version> [--dry-run|--publish]}"
MODE_ARG="${2:---dry-run}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK_DIR="$ROOT/sdks/python"

# shellcheck source=common.sh
source "$ROOT/scripts/release/common.sh"

MODE="$(release_mode_from_arg "$MODE_ARG")"
require_semver "$VERSION"
ensure_clean_worktree "$ROOT"
require_cmd python3
require_cmd git
require_cmd twine
ensure_file "$SDK_DIR/pyproject.toml"
log_release_mode "Python SDK" "$VERSION" "$MODE"

current_version="$(
    python3 -c 'import tomllib, pathlib; data = tomllib.loads(pathlib.Path("'"$SDK_DIR"'/pyproject.toml").read_text()); print(data["project"]["version"])'
)"
assert_version_match "$VERSION" "$current_version" "sdks/python/pyproject.toml [project.version]"

maybe_run_smoke_suite "$ROOT"

cd "$SDK_DIR"
python3 -m pip install --upgrade build
rm -rf dist build
python3 -m build
twine check dist/*

if [[ "$MODE" == "dry-run" ]]; then
    echo "Python SDK package build verified for $VERSION (publish skipped)"
    exit 0
fi

confirm_publish_if_needed "Python SDK" "$VERSION" "$MODE"
twine upload dist/*

echo "Python SDK published: $VERSION"
