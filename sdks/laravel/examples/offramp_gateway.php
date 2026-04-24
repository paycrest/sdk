<?php
/**
 * Off-ramp via the direct Gateway contract path (method = 'gateway').
 *
 * The PHP SDK delegates signing and broadcasting to a caller-supplied
 * GatewayTransactor. The snippet below sketches a web3.php-backed
 * adapter — adapt it to whichever wallet library your Laravel app
 * already uses.
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Paycrest\SDK\Client\PaycrestClient;
use Paycrest\SDK\Gateway\GatewayTransactor;

final class Web3PhpTransactor implements GatewayTransactor
{
    // Real adapter would hold a web3.php client + EC keypair.
    public function chainId(): int { return 8453; }
    public function senderAddress(): string { return '0xSenderEoa'; }
    public function allowance(string $token, string $owner, string $spender): string { return '0'; }
    public function approve(string $token, string $spender, string $amount): string { return '0xApproveTxHash'; }
    public function createOrder(string $gateway, array $args): string { return '0xCreateTxHash'; }
}

$client = new PaycrestClient(
    senderApiKey: getenv('PAYCREST_SENDER_API_KEY') ?: null,
    gatewayTransactor: new Web3PhpTransactor(),
);

$result = $client->sender()->createOfframpOrder([
    'amount' => '100',
    'rate' => '1500',
    'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xSenderEoa'],
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
], method: 'gateway');

print_r($result);
