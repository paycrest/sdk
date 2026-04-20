#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_rust.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT/sdks/rust"
cargo package
cargo publish

echo "Rust SDK published: $VERSION"
