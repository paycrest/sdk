#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"

"$ROOT/scripts/tests/smoke_typescript.sh"
"$ROOT/scripts/tests/smoke_python.sh"
"$ROOT/scripts/tests/smoke_go.sh"
"$ROOT/scripts/tests/smoke_rust.sh"
"$ROOT/scripts/tests/smoke_laravel.sh"

echo "All smoke checks completed"

if [[ "${RUN_LIVE_INTEGRATION:-0}" == "1" ]]; then
    "$ROOT/scripts/tests/integration_typescript.sh"
    "$ROOT/scripts/tests/integration_python.sh"
    "$ROOT/scripts/tests/integration_go.sh"
    "$ROOT/scripts/tests/integration_rust.sh"
    "$ROOT/scripts/tests/integration_laravel.sh"
    echo "All live integration checks completed"
fi
