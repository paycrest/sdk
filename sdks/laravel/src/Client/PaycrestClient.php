<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Gateway\GatewayClient;
use Paycrest\SDK\Gateway\GatewayTransactor;
use RuntimeException;

class PaycrestClient
{
    private readonly ?HttpClient $senderHttp;
    private readonly ?HttpClient $providerHttp;
    private readonly HttpClient $publicHttp;
    private readonly ?GatewayClient $gatewayClient;

    public function __construct(
        ?string $apiKey = null,
        ?string $senderApiKey = null,
        ?string $providerApiKey = null,
        string $baseUrl = 'https://api.paycrest.io/v2',
        int $timeout = 20,
        ?GatewayTransactor $gatewayTransactor = null,
        ?string $aggregatorPublicKeyOverride = null,
        ?RequestHooks $hooks = null,
    ) {
        $resolvedSenderKey = $senderApiKey ?: $apiKey;
        $resolvedProviderKey = $providerApiKey ?: $apiKey;

        $this->senderHttp = $resolvedSenderKey ? new HttpClient($resolvedSenderKey, $baseUrl, $timeout, null, $hooks) : null;
        $this->providerHttp = $resolvedProviderKey ? new HttpClient($resolvedProviderKey, $baseUrl, $timeout, null, $hooks) : null;
        $this->publicHttp = new HttpClient('', $baseUrl, $timeout, null, $hooks);
        $this->gatewayClient = $gatewayTransactor
            ? new GatewayClient($this->publicHttp, $gatewayTransactor, $aggregatorPublicKeyOverride)
            : null;
    }

    public function sender(): SenderClient
    {
        if ($this->senderHttp === null) {
            throw new RuntimeException('senderApiKey (or apiKey) is required');
        }

        return new SenderClient($this->senderHttp, $this->gatewayClient);
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
