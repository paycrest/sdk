#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_all.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

"$ROOT/scripts/release/release_typescript.sh" "$VERSION"
"$ROOT/scripts/release/release_python.sh" "$VERSION"
"$ROOT/scripts/release/release_go.sh" "$VERSION"
"$ROOT/scripts/release/release_rust.sh" "$VERSION"
"$ROOT/scripts/release/release_laravel.sh" "$VERSION"

echo "All release flows completed for $VERSION"
