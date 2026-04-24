#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/python"

# Install the package + its declared dependencies (cryptography, etc.)
# so test imports resolve. `pip install .` is intentional — we want a
# real install so new deps added to pyproject.toml are auto-picked up
# by CI without further script edits.
python3 -m pip install --quiet --disable-pip-version-check . >/dev/null

python3 -m unittest discover -s tests -p 'test_*.py'
