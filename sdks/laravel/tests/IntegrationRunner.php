<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Paycrest\SDK\Client\PaycrestClient;

$baseUrl = getenv('PAYCREST_BASE_URL') ?: 'https://api.paycrest.io/v2';
$senderKey = getenv('PAYCREST_SENDER_API_KEY') ?: '';
$providerKey = getenv('PAYCREST_PROVIDER_API_KEY') ?: '';

if ($senderKey === '' && $providerKey === '') {
    fwrite(STDOUT, "Skipping Laravel integration: set PAYCREST_SENDER_API_KEY and/or PAYCREST_PROVIDER_API_KEY\n");
    exit(0);
}

$client = new PaycrestClient(
    apiKey: null,
    senderApiKey: $senderKey !== '' ? $senderKey : null,
    providerApiKey: $providerKey !== '' ? $providerKey : null,
    baseUrl: $baseUrl,
);

if ($senderKey !== '') {
    $senderStats = $client->sender()->getStats();
    if (!is_array($senderStats)) {
        throw new RuntimeException('Unexpected sender stats response shape.');
    }
    fwrite(STDOUT, "Laravel sender integration check passed\n");
}

if ($providerKey !== '') {
    $providerStats = $client->provider()->getStats(null);
    if (!is_array($providerStats)) {
        throw new RuntimeException('Unexpected provider stats response shape.');
    }
    fwrite(STDOUT, "Laravel provider integration check passed\n");
}
