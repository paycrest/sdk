#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"

"$ROOT/scripts/tests/integration_typescript.sh"
"$ROOT/scripts/tests/integration_python.sh"
"$ROOT/scripts/tests/integration_go.sh"
"$ROOT/scripts/tests/integration_rust.sh"
"$ROOT/scripts/tests/integration_laravel.sh"

echo "All integration checks completed"
