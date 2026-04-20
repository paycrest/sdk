#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_laravel.sh <version>}"

cat <<EOF
Laravel SDK release prepared: $VERSION
1) Push tag v$VERSION to sdk-laravel repository.
2) Ensure Packagist points to that tag.
EOF
