#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/laravel"

if ! command -v php >/dev/null 2>&1; then
    echo "php not installed, skipping laravel smoke"
    exit 0
fi

if ! command -v composer >/dev/null 2>&1; then
    echo "composer not installed, skipping laravel smoke"
    exit 0
fi

if [ ! -d "vendor" ]; then
    composer install --no-interaction --prefer-dist
fi

php -l src/Client/PaycrestClient.php
php -l src/Client/SenderClient.php
php -l src/Client/ProviderClient.php

composer run test:contract
