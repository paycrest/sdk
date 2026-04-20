<?php

namespace Paycrest\SDK\Client;

use RuntimeException;

class PaycrestClient
{
    private readonly HttpClient $http;

    public function __construct(
        string $apiKey,
        string $baseUrl = 'https://api.paycrest.io/v2',
        int $timeout = 20,
    ) {
        if ($apiKey === '') {
            throw new RuntimeException('PAYCREST_API_KEY is required');
        }

        $this->http = new HttpClient($apiKey, $baseUrl, $timeout);
    }

    public function sender(): SenderClient
    {
        return new SenderClient($this->http);
    }

    public function provider(): never
    {
        throw new RuntimeException('Provider SDK support is not available yet in v2 monorepo');
    }

    public static function verifyWebhookSignature(string $rawBody, string $signature, string $secret): bool
    {
        $digest = hash_hmac('sha256', $rawBody, $secret);
        return hash_equals($digest, $signature);
    }
}
