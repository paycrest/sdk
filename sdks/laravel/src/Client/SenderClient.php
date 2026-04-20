<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Contracts\SenderClientInterface;
use RuntimeException;

class SenderClient implements SenderClientInterface
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    public function createOrder(array $payload): array
    {
        $sourceType = $payload['source']['type'] ?? null;
        $destinationType = $payload['destination']['type'] ?? null;

        if ($sourceType === 'crypto' && $destinationType === 'fiat') {
            return $this->createOfframpOrder($payload);
        }
        if ($sourceType === 'fiat' && $destinationType === 'crypto') {
            return $this->createOnrampOrder($payload);
        }

        throw new RuntimeException('Invalid sender order direction. Expected crypto->fiat or fiat->crypto.');
    }

    public function createOfframpOrder(array $payload): array
    {
        $payload = $this->resolveRateIfMissing(
            $payload,
            network: (string)($payload['source']['network'] ?? ''),
            token: (string)($payload['source']['currency'] ?? ''),
            amount: (string)($payload['amount'] ?? ''),
            fiat: (string)($payload['destination']['currency'] ?? ''),
            side: 'sell',
        );

        $response = $this->http->request('POST', '/sender/orders', $payload);
        return $response['data'];
    }

    public function createOnrampOrder(array $payload): array
    {
        $payload = $this->resolveRateIfMissing(
            $payload,
            network: (string)($payload['destination']['recipient']['network'] ?? ''),
            token: (string)($payload['destination']['currency'] ?? ''),
            amount: (string)($payload['amount'] ?? ''),
            fiat: (string)($payload['source']['currency'] ?? ''),
            side: 'buy',
        );

        $response = $this->http->request('POST', '/sender/orders', $payload);
        return $response['data'];
    }

    public function listOrders(array $query = []): array
    {
        $response = $this->http->request('GET', '/sender/orders', null, [
            'page' => $query['page'] ?? 1,
            'pageSize' => $query['pageSize'] ?? 10,
            'status' => $query['status'] ?? null,
        ]);
        return $response['data'];
    }

    public function getOrder(string $orderId): array
    {
        $response = $this->http->request('GET', "/sender/orders/{$orderId}");
        return $response['data'];
    }

    public function getStats(): array
    {
        $response = $this->http->request('GET', '/sender/stats');
        return $response['data'];
    }

    public function verifyAccount(string $institution, string $accountIdentifier): string
    {
        $response = $this->http->request('POST', '/verify-account', [
            'institution' => $institution,
            'accountIdentifier' => $accountIdentifier,
        ]);

        return (string)$response['data'];
    }

    public function getTokenRate(
        string $network,
        string $token,
        string $amount,
        string $fiat,
        ?string $side = null,
        ?string $providerId = null,
    ): array {
        $response = $this->http->request(
            'GET',
            "/rates/{$network}/{$token}/{$amount}/{$fiat}",
            null,
            [
                'side' => $side,
                'provider_id' => $providerId,
            ],
        );

        return $response['data'];
    }

    private function resolveRateIfMissing(
        array $payload,
        string $network,
        string $token,
        string $amount,
        string $fiat,
        string $side,
    ): array {
        if (!empty($payload['rate'])) {
            return $payload;
        }

        $quote = $this->getTokenRate($network, $token, $amount, $fiat, $side, null);
        $sideQuote = $quote[$side] ?? null;
        $rate = is_array($sideQuote) ? ($sideQuote['rate'] ?? null) : null;

        if (!is_string($rate) || $rate === '') {
            throw new RuntimeException("Unable to fetch {$side} rate for requested order.");
        }

        $payload['rate'] = $rate;
        return $payload;
    }
}
