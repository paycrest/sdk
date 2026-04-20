#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/laravel"

if ! command -v php >/dev/null 2>&1; then
    echo "php not installed, skipping laravel smoke"
    exit 0
fi

php -l src/Client/PaycrestClient.php
php -l src/Client/SenderClient.php
