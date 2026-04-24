<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Contracts\ProviderClientInterface;
use Paycrest\SDK\Queries\ProviderListOrdersQuery;

class ProviderClient implements ProviderClientInterface
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /**
     * List provider-matched orders. Accepts either a typed
     * {@see ProviderListOrdersQuery} or the legacy associative array.
     *
     * @param ProviderListOrdersQuery|array $query
     */
    public function listOrders(ProviderListOrdersQuery|array $query): array
    {
        if (is_array($query)) {
            $query = new ProviderListOrdersQuery(
                currency: (string)($query['currency'] ?? ''),
                page: (int)($query['page'] ?? 1),
                pageSize: (int)($query['pageSize'] ?? 10),
                status: $query['status'] ?? null,
                ordering: $query['ordering'] ?? null,
                search: $query['search'] ?? null,
                export: $query['export'] ?? null,
                from: $query['from'] ?? null,
                to: $query['to'] ?? null,
            );
        }
        $response = $this->http->request('GET', '/provider/orders', null, [
            'currency' => $query->currency,
            'page' => $query->page,
            'pageSize' => $query->pageSize,
            'status' => $query->status,
            'ordering' => $query->ordering,
            'search' => $query->search,
            'export' => $query->export,
            'from' => $query->from,
            'to' => $query->to,
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
