#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/laravel"

if ! command -v php >/dev/null 2>&1; then
  echo "php not installed, skipping laravel integration"
  exit 0
fi

if ! command -v composer >/dev/null 2>&1; then
  echo "composer not installed, skipping laravel integration"
  exit 0
fi

if [[ -z "${PAYCREST_BASE_URL:-}" || -z "${PAYCREST_SENDER_API_KEY:-}" || -z "${PAYCREST_PROVIDER_API_KEY:-}" ]]; then
  echo "Missing PAYCREST_BASE_URL / PAYCREST_SENDER_API_KEY / PAYCREST_PROVIDER_API_KEY, skipping laravel integration"
  exit 0
fi

if [ ! -d "vendor" ]; then
  composer install --no-interaction --prefer-dist
fi

php <<'PHP'
<?php
require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/src/Client/HttpClient.php';
require __DIR__ . '/src/Client/SenderClient.php';
require __DIR__ . '/src/Client/ProviderClient.php';
require __DIR__ . '/src/Client/PaycrestClient.php';

use Paycrest\SDK\Client\PaycrestClient;

$client = new PaycrestClient(
    apiKey: null,
    senderApiKey: getenv('PAYCREST_SENDER_API_KEY') ?: null,
    providerApiKey: getenv('PAYCREST_PROVIDER_API_KEY') ?: null,
    baseUrl: getenv('PAYCREST_BASE_URL') ?: 'https://api.paycrest.io/v2',
    timeout: 20,
);

$senderStats = $client->sender()->getStats();
$providerStats = $client->provider()->getStats(null);

echo "laravel integration sender stats ok\n";
echo "laravel integration provider stats ok\n";
echo json_encode([
    'senderStatsType' => gettype($senderStats),
    'providerStatsType' => gettype($providerStats),
], JSON_THROW_ON_ERROR) . "\n";
PHP
