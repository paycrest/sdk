<?php

namespace Paycrest\SDK\Contracts;

use Paycrest\SDK\Queries\ListOrdersQuery;

interface SenderClientInterface
{
    public function createOrder(array $payload): array;
    public function createOfframpOrder(array $payload, string $method = 'api', ?string $idempotencyKey = null): array;
    public function createOnrampOrder(array $payload, ?string $idempotencyKey = null): array;
    public function listOrders(ListOrdersQuery|array $query = []): array;
    public function getOrder(string $orderId): array;
    public function getStats(): array;
    public function verifyAccount(string $institution, string $accountIdentifier): string;
}
