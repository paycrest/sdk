#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_laravel.sh <version> [--dry-run|--publish]}"
MODE_ARG="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK_DIR="$ROOT/sdks/laravel"

# shellcheck source=common.sh
source "$ROOT/scripts/release/common.sh"

MODE="$(release_mode_from_arg "$MODE_ARG")"

require_semver "$VERSION"
ensure_clean_worktree "$ROOT"
require_cmd git
require_cmd php
require_cmd composer
maybe_run_smoke_suite "$ROOT"
confirm_publish_if_needed "Laravel SDK" "$VERSION" "$MODE"
log_release_mode "Laravel SDK" "$VERSION" "$MODE"

cd "$SDK_DIR"
current_version="$(php -r '$json=json_decode(file_get_contents("composer.json"), true, 512, JSON_THROW_ON_ERROR); echo $json["version"] ?? "unknown";')"
if [[ "$current_version" != "unknown" ]]; then
    assert_version_match "$VERSION" "$current_version" "sdks/laravel/composer.json version"
fi

if [[ ! -d "vendor" ]]; then
    composer install --no-interaction --prefer-dist
fi

composer run test:contract

cat <<EOF
Laravel SDK release prepared: $VERSION.
Next steps in sdk-laravel repository:
  git tag v$VERSION
  git push origin v$VERSION
  Ensure Packagist points to that tag.
EOF

if [[ "$MODE" == "dry-run" ]]; then
    echo "Dry run complete for Laravel release."
fi
