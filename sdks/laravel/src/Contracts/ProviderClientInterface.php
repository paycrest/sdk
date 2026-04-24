<?php

namespace Paycrest\SDK\Contracts;

use Paycrest\SDK\Queries\ProviderListOrdersQuery;

interface ProviderClientInterface
{
    public function listOrders(ProviderListOrdersQuery|array $query): array;
    public function getOrder(string $orderId): array;
    public function getStats(?string $currency = null): array;
    public function getNodeInfo(): array;
    public function getMarketRate(string $token, string $fiat): array;
}
