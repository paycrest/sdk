#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"

"$ROOT/scripts/tests/smoke_typescript.sh"
"$ROOT/scripts/tests/smoke_python.sh"
"$ROOT/scripts/tests/smoke_go.sh"
"$ROOT/scripts/tests/smoke_rust.sh"
"$ROOT/scripts/tests/smoke_laravel.sh"

echo "All smoke checks completed"
