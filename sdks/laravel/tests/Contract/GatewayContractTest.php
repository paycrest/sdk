<?php

declare(strict_types=1);

use Paycrest\SDK\Client\PaycrestClient;
use Paycrest\SDK\Client\SenderClient;
use Paycrest\SDK\Gateway\Encryption;
use Paycrest\SDK\Gateway\GatewayClient;
use Paycrest\SDK\Gateway\GatewayTransactor;
use Paycrest\SDK\Networks\Networks;
use Paycrest\SDK\Tests\Support\MockHttpClient;

/** Test-only transactor that records every call the SDK makes. */
final class StubTransactor implements GatewayTransactor
{
    public array $calls = [];
    public string $allowance = '0';

    public function chainId(): int { $this->calls[] = ['chainId']; return 8453; }
    public function senderAddress(): string { return '0xSenderEoa'; }
    public function allowance(string $token, string $owner, string $spender): string
    {
        $this->calls[] = ['allowance', $token, $owner, $spender];
        return $this->allowance;
    }
    public function approve(string $token, string $spender, string $amount): string
    {
        $this->calls[] = ['approve', $token, $spender, $amount];
        return '0xApproveTxHash';
    }
    public function createOrder(string $gateway, array $args): string
    {
        $this->calls[] = ['createOrder', $gateway, $args];
        return '0xCreateTxHash';
    }
}

it('scales rate and converts to subunits correctly', function (): void {
    expect(GatewayClient::toSubunits('1', 6))->toBe('1000000');
    expect(GatewayClient::toSubunits('1.5', 6))->toBe('1500000');
    expect(GatewayClient::toSubunits('0.000001', 6))->toBe('1');

    expect(fn () => GatewayClient::toSubunits('0.0000001', 6))
        ->toThrow(\InvalidArgumentException::class);

    expect(GatewayClient::scaleRate('1500'))->toBe('150000');
    expect(GatewayClient::scaleRate('1499.99'))->toBe('149999');
    expect(GatewayClient::scaleRate('1.23'))->toBe('123');
});

it('resolves registered networks and rejects unknown ones', function (): void {
    $base = Networks::get('base');
    expect($base['chainId'])->toBe(8453);
    expect($base['gateway'])->toBe('0x30f6a8457f8e42371e204a9c103f2bd42341dd0f');

    expect(fn () => Networks::get('not-a-network'))
        ->toThrow(\InvalidArgumentException::class);
});

it('produces a decryptable hybrid envelope matching the aggregator layout', function (): void {
    $keyRes = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    $details = openssl_pkey_get_details($keyRes);
    $publicPem = $details['key'];

    $recipient = Encryption::buildRecipientPayload([
        'institution' => 'GTBINGLA',
        'accountIdentifier' => '1234567890',
        'accountName' => 'Jane Doe',
        'memo' => 'Payout',
        'providerId' => 'AbCdEfGh',
    ]);
    $envelopeB64 = Encryption::encryptRecipient($recipient, $publicPem);
    $envelope = base64_decode($envelopeB64, true);
    expect($envelope)->toBeString();

    $keyLen = unpack('N', substr($envelope, 0, 4))[1];
    $encryptedKey = substr($envelope, 4, $keyLen);
    $aesBlock = substr($envelope, 4 + $keyLen);

    $aesKey = '';
    openssl_private_decrypt($encryptedKey, $aesKey, $keyRes, OPENSSL_PKCS1_PADDING);
    expect($aesKey)->toBeString()->not()->toBe('');

    $nonce = substr($aesBlock, 0, 12);
    $tag = substr($aesBlock, -16);
    $ciphertext = substr($aesBlock, 12, strlen($aesBlock) - 12 - 16);
    $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $aesKey, OPENSSL_RAW_DATA, $nonce, $tag, '');
    expect($plaintext)->toBeString();

    $decoded = json_decode($plaintext, true, 512, JSON_THROW_ON_ERROR);
    expect($decoded['Institution'])->toBe('GTBINGLA');
    expect($decoded['AccountIdentifier'])->toBe('1234567890');
    expect($decoded['ProviderID'])->toBe('AbCdEfGh');
    expect($decoded['Memo'])->toBe('Payout');
    expect($decoded['Nonce'])->toBeString();
});

it('drives approve + createOrder through the injected transactor', function (): void {
    $keyRes = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    $details = openssl_pkey_get_details($keyRes);
    $publicPem = $details['key'];

    $http = new MockHttpClient([]);
    $transactor = new StubTransactor();
    $gateway = new GatewayClient($http, $transactor, $publicPem);
    $gateway->seedTokens('base', [
        ['symbol' => 'USDT', 'contractAddress' => '0xTokenAddress', 'decimals' => 6, 'baseCurrency' => 'USD', 'network' => 'base'],
    ]);

    $result = $gateway->createOfframpOrder([
        'amount' => '100',
        'rate' => '1500',
        'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xRefundAddress'],
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

    expect($result['txHash'])->toBe('0xCreateTxHash');
    expect($result['approveTxHash'])->toBe('0xApproveTxHash');
    expect($result['gatewayAddress'])->toBe('0x30f6a8457f8e42371e204a9c103f2bd42341dd0f');
    expect($result['amount'])->toBe('100000000');
    expect($result['refundAddress'])->toBe('0xRefundAddress');
    expect($result['network'])->toBe('base');

    $createCall = collect($transactor->calls)->first(fn ($c) => $c[0] === 'createOrder');
    expect($createCall[2]['token'])->toBe('0xTokenAddress');
    expect($createCall[2]['amount'])->toBe('100000000');
    expect($createCall[2]['rate'])->toBe('150000');
    expect($createCall[2]['messageHash'])->toBeString()->not()->toBe('');
});

it('throws a helpful error when the gateway path is invoked without a transactor', function (): void {
    $client = new PaycrestClient(senderApiKey: 'sender-key');
    $sender = $client->sender();
    expect(fn () => $sender->createOfframpOrder([
        'amount' => '100',
        'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xabc'],
        'destination' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'recipient' => [
                'institution' => 'GTBINGLA',
                'accountIdentifier' => '1234567890',
                'accountName' => 'Jane',
                'memo' => 'Payout',
            ],
        ],
    ], method: 'gateway'))->toThrow(\RuntimeException::class, 'Gateway dispatch is not configured');
});
