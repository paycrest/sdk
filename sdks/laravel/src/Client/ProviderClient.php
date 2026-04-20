<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Contracts\ProviderClientInterface;

class ProviderClient implements ProviderClientInterface
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    public function listOrders(array $query): array
    {
        $response = $this->http->request('GET', '/provider/orders', null, [
            'currency' => $query['currency'] ?? null,
            'page' => $query['page'] ?? 1,
            'pageSize' => $query['pageSize'] ?? 10,
            'status' => $query['status'] ?? null,
            'ordering' => $query['ordering'] ?? null,
            'search' => $query['search'] ?? null,
            'export' => $query['export'] ?? null,
            'from' => $query['from'] ?? null,
            'to' => $query['to'] ?? null,
        ]);
        return $response['data'];
    }

    public function getOrder(string $orderId): array
    {
        $response = $this->http->request('GET', "/provider/orders/{$orderId}");
        return $response['data'];
    }

    public function getStats(?string $currency = null): array
    {
        $response = $this->http->request('GET', '/provider/stats', null, [
            'currency' => $currency,
        ]);
        return $response['data'];
    }

    public function getNodeInfo(): array
    {
        $response = $this->http->request('GET', '/provider/node-info');
        return $response['data'];
    }

    public function getMarketRate(string $token, string $fiat): array
    {
        $response = $this->http->request('GET', "/provider/rates/{$token}/{$fiat}");
        return $response['data'];
    }
}
