<?php

namespace Paycrest\SDK\Contracts;

interface SenderClientInterface
{
    public function createOrder(array $payload): array;
    public function createOfframpOrder(array $payload): array;
    public function createOnrampOrder(array $payload): array;
    public function listOrders(array $query = []): array;
    public function getOrder(string $orderId): array;
    public function getStats(): array;
    public function verifyAccount(string $institution, string $accountIdentifier): string;
}
