#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_go.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT/sdks/go"
go test ./...

cat <<EOF
Go SDK release prepared: $VERSION
Next step in sdk-go repository:
  git tag v$VERSION
  git push origin v$VERSION
EOF
