<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Contracts\SenderClientInterface;
use Paycrest\SDK\Errors\PaycrestApiError;
use Paycrest\SDK\Errors\RateQuoteUnavailableError;
use Paycrest\SDK\Errors\ValidationError;
use Paycrest\SDK\Gateway\GatewayClient;
use Paycrest\SDK\Queries\ListOrdersQuery;
use Paycrest\SDK\Queries\WaitForStatusOptions;

class SenderClient implements SenderClientInterface
{
    private const TERMINAL_STATUSES = ['settled', 'refunded', 'expired', 'cancelled'];

    public function __construct(
        private readonly HttpClient $http,
        private readonly ?GatewayClient $gatewayClient = null,
    ) {
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

        throw new ValidationError('Invalid sender order direction. Expected crypto->fiat or fiat->crypto.');
    }

    /**
     * Create an off-ramp order.
     *
     * @param string $method 'api' (default, aggregator-managed) or
     *                       'gateway' (direct on-chain dispatch via the
     *                       configured transactor).
     *
     * @return array  When method='api', a PaymentOrder envelope. When
     *                method='gateway', a GatewayOrderResult:
     *                `{ txHash, approveTxHash, gatewayAddress, tokenAddress,
     *                   amount, rate, messageHash, refundAddress, network }`.
     */
    public function createOfframpOrder(array $payload, string $method = 'api', ?string $idempotencyKey = null): array
    {
        if ($method === 'gateway') {
            if ($this->gatewayClient === null) {
                throw new ValidationError('Gateway dispatch is not configured. Pass gatewayTransactor to PaycrestClient.');
            }
            return $this->gatewayClient->createOfframpOrder($payload);
        }
        if ($method !== 'api') {
            throw new ValidationError("Unknown off-ramp method \"{$method}\"");
        }

        $payload = $this->ensureReference(
            $this->resolveRateIfMissing(
                $payload,
                network: (string)($payload['source']['network'] ?? ''),
                token: (string)($payload['source']['currency'] ?? ''),
                amount: (string)($payload['amount'] ?? ''),
                fiat: (string)($payload['destination']['currency'] ?? ''),
                side: 'sell',
            )
        );

        $response = $this->http->request('POST', '/sender/orders', $payload, [], $idempotencyKey);
        return $response['data'];
    }

    public function createOnrampOrder(array $payload, ?string $idempotencyKey = null): array
    {
        $payload = $this->ensureReference(
            $this->resolveRateIfMissing(
                $payload,
                network: (string)($payload['destination']['recipient']['network'] ?? ''),
                token: (string)($payload['destination']['currency'] ?? ''),
                amount: (string)($payload['amount'] ?? ''),
                fiat: (string)($payload['source']['currency'] ?? ''),
                side: 'buy',
            )
        );

        $response = $this->http->request('POST', '/sender/orders', $payload, [], $idempotencyKey);
        return $response['data'];
    }

    /**
     * Stamp the payload with a UUID reference when the caller didn't
     * provide one — gives the aggregator a stable dedup key across
     * retries of the same logical request.
     */
    private function ensureReference(array $payload): array
    {
        if (!empty($payload['reference']) && is_string($payload['reference'])) {
            return $payload;
        }
        $payload['reference'] = \Paycrest\SDK\Support\Uuid::v4();
        return $payload;
    }

    /**
     * Yield each sender order across every page, one at a time.
     *
     * @param ListOrdersQuery|array $query
     * @return \Generator<int, array<string, mixed>>
     */
    public function iterateOrders(ListOrdersQuery|array $query = []): \Generator
    {
        if (is_array($query)) {
            $query = new ListOrdersQuery(
                page: (int)($query['page'] ?? 1),
                pageSize: (int)($query['pageSize'] ?? 50),
                status: $query['status'] ?? null,
            );
        }
        $page = max(1, $query->page);
        $yielded = 0;
        while (true) {
            $response = $this->listOrders(new ListOrdersQuery(page: $page, pageSize: $query->pageSize, status: $query->status));
            $orders = $response['orders'] ?? [];
            if (!is_array($orders) || count($orders) === 0) {
                return;
            }
            foreach ($orders as $order) {
                $yielded++;
                yield $order;
            }
            $total = (int)($response['total'] ?? 0);
            if ($total > 0 && $yielded >= $total) {
                return;
            }
            $page++;
        }
    }

    /**
     * Collect every page into a single array. Prefer iterateOrders()
     * for streaming workloads.
     *
     * @param ListOrdersQuery|array $query
     * @return array<int, array<string, mixed>>
     */
    public function listAllOrders(ListOrdersQuery|array $query = []): array
    {
        return iterator_to_array($this->iterateOrders($query), false);
    }

    /**
     * List sender orders. Accepts either a {@see ListOrdersQuery}
     * value object or the legacy associative array (``['page' => …,
     * 'pageSize' => …, 'status' => …]``) for backwards compatibility.
     *
     * @param ListOrdersQuery|array $query
     */
    public function listOrders(ListOrdersQuery|array $query = []): array
    {
        if (is_array($query)) {
            $query = new ListOrdersQuery(
                page: (int)($query['page'] ?? 1),
                pageSize: (int)($query['pageSize'] ?? 10),
                status: $query['status'] ?? null,
            );
        }
        $response = $this->http->request('GET', '/sender/orders', null, [
            'page' => $query->page,
            'pageSize' => $query->pageSize,
            'status' => $query->status,
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

    /**
     * Poll ``getOrder($orderId)`` until the order reaches ``$target``
     * or the timeout expires.
     *
     * @param string|array<int,string> $target  One of: a specific status,
     *        an array of statuses, or the literal ``"terminal"`` (any of
     *        settled/refunded/expired/cancelled).
     */
    public function waitForStatus(
        string $orderId,
        string|array $target,
        ?WaitForStatusOptions $options = null,
    ): array {
        $opts = $options ?? new WaitForStatusOptions();
        $deadlineMs = (int)(microtime(true) * 1000) + $opts->timeoutMs;

        while (true) {
            $order = $this->getOrder($orderId);
            if (self::matchesTarget((string)($order['status'] ?? ''), $target)) {
                return $order;
            }
            $nowMs = (int)(microtime(true) * 1000);
            if ($nowMs >= $deadlineMs) {
                throw new PaycrestApiError(
                    sprintf(
                        'Timed out waiting for order %s to reach %s; last status=%s',
                        $orderId,
                        self::describeTarget($target),
                        (string)($order['status'] ?? 'unknown'),
                    ),
                    408,
                    $order,
                );
            }
            $sleepMs = min($opts->pollMs, $deadlineMs - $nowMs);
            usleep($sleepMs * 1000);
        }
    }

    /**
     * @param string|array<int,string> $target
     */
    private static function matchesTarget(string $status, string|array $target): bool
    {
        if ($target === 'terminal') {
            return in_array($status, self::TERMINAL_STATUSES, true);
        }
        if (is_array($target)) {
            return in_array($status, $target, true);
        }
        return $status === $target;
    }

    /**
     * @param string|array<int,string> $target
     */
    private static function describeTarget(string|array $target): string
    {
        if ($target === 'terminal') {
            return 'a terminal status';
        }
        if (is_array($target)) {
            return implode('|', $target);
        }
        return $target;
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
            throw new RateQuoteUnavailableError(
                "Unable to fetch {$side} rate for requested order.",
                $quote,
            );
        }

        $payload['rate'] = $rate;
        return $payload;
    }
}
