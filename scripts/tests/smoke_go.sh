#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/go"

if command -v go1.26.0 >/dev/null 2>&1; then
    go1.26.0 test ./...
elif [ -x "/home/ubuntu/go/bin/go1.26.0" ]; then
    /home/ubuntu/go/bin/go1.26.0 test ./...
else
    echo "go1.26.0 not available in this environment; skipping go smoke"
    exit 0
fi
