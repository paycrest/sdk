#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: release_python.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT/sdks/python"
python3 -m pip install --upgrade build twine
python3 -m build
twine upload dist/*

echo "Python SDK published: $VERSION"
