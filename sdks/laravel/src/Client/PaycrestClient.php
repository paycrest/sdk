<?php

namespace Paycrest\SDK\Client;

use RuntimeException;

class PaycrestClient
{
    private readonly ?HttpClient $senderHttp;
    private readonly ?HttpClient $providerHttp;

    public function __construct(
        ?string $apiKey = null,
        ?string $senderApiKey = null,
        ?string $providerApiKey = null,
        string $baseUrl = 'https://api.paycrest.io/v2',
        int $timeout = 20,
    ) {
        $resolvedSenderKey = $senderApiKey ?: $apiKey;
        $resolvedProviderKey = $providerApiKey ?: $apiKey;

        $this->senderHttp = $resolvedSenderKey ? new HttpClient($resolvedSenderKey, $baseUrl, $timeout) : null;
        $this->providerHttp = $resolvedProviderKey ? new HttpClient($resolvedProviderKey, $baseUrl, $timeout) : null;
    }

    public function sender(): SenderClient
    {
        if ($this->senderHttp === null) {
            throw new RuntimeException('senderApiKey (or apiKey) is required');
        }

        return new SenderClient($this->senderHttp);
    }

    public function provider(): ProviderClient
    {
        if ($this->providerHttp === null) {
            throw new RuntimeException('providerApiKey (or apiKey) is required');
        }

        return new ProviderClient($this->providerHttp);
    }

    public static function verifyWebhookSignature(string $rawBody, string $signature, string $secret): bool
    {
        $digest = hash_hmac('sha256', $rawBody, $secret);
        return hash_equals($digest, $signature);
    }
}
