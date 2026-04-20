<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Contracts\SenderClientInterface;

class SenderClient implements SenderClientInterface
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    public function createOrder(array $payload): array
    {
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
}
