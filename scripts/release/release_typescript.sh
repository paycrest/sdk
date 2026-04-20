#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_typescript.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT/sdks/typescript"
npm version "$VERSION" --no-git-tag-version
npm publish --access public

echo "TypeScript SDK published: $VERSION"
