#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/go"

if ! command -v go1.26.0 >/dev/null 2>&1; then
    echo "go1.26.0 is required on PATH for Go smoke tests"
    exit 1
fi

go1.26.0 version
go1.26.0 test ./...
