<?php
/**
 * Cross-SDK parity client (PHP).
 */

declare(strict_types=1);

require __DIR__ . '/../../../sdks/laravel/vendor/autoload.php';

use Paycrest\SDK\Client\PaycrestClient;

$baseUrl = getenv('PAYCREST_BASE_URL');
if (!$baseUrl) {
    fwrite(STDERR, "PAYCREST_BASE_URL is required\n");
    exit(1);
}

$client = new PaycrestClient(
    senderApiKey: 'parity-key',
    baseUrl: $baseUrl,
);
$sender = $client->sender();

$order = $sender->createOfframpOrder([
    'amount' => '100',
    'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xabc'],
    'destination' => [
        'type' => 'fiat',
        'currency' => 'NGN',
        'recipient' => [
            'institution' => 'GTBINGLA',
            'accountIdentifier' => '1234567890',
            'accountName' => 'Jane Doe',
            'memo' => 'Payout',
        ],
    ],
]);
if (empty($order['id'])) {
    fwrite(STDERR, "php-client: no order id returned\n");
    exit(2);
}
$refreshed = $sender->getOrder($order['id']);
if (($refreshed['status'] ?? null) !== 'settled') {
    fwrite(STDERR, "php-client: unexpected status {$refreshed['status']}\n");
    exit(3);
}
echo "php-client: OK\n";
