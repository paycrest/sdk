<?php

declare(strict_types=1);

use Paycrest\SDK\Client\SenderClient;
use Paycrest\SDK\Errors\AuthenticationError;
use Paycrest\SDK\Errors\ErrorClassifier;
use Paycrest\SDK\Errors\NotFoundError;
use Paycrest\SDK\Errors\PaycrestApiError;
use Paycrest\SDK\Errors\ProviderUnavailableError;
use Paycrest\SDK\Errors\RateLimitError;
use Paycrest\SDK\Errors\RateQuoteUnavailableError;
use Paycrest\SDK\Errors\ValidationError;
use Paycrest\SDK\Queries\ListOrdersQuery;
use Paycrest\SDK\Queries\WaitForStatusOptions;
use Paycrest\SDK\Tests\Support\MockHttpClient;

it('classifies HTTP errors into typed subclasses', function (): void {
    expect(ErrorClassifier::classifyHttpError(400, 'bad'))->toBeInstanceOf(ValidationError::class);
    expect(ErrorClassifier::classifyHttpError(401, 'bad'))->toBeInstanceOf(AuthenticationError::class);
    expect(ErrorClassifier::classifyHttpError(403, 'bad'))->toBeInstanceOf(AuthenticationError::class);
    expect(ErrorClassifier::classifyHttpError(404, 'bad'))->toBeInstanceOf(NotFoundError::class);

    $rl = ErrorClassifier::classifyHttpError(429, 'slow', null, 2.5);
    expect($rl)->toBeInstanceOf(RateLimitError::class);
    expect($rl->retryAfterSeconds)->toBe(2.5);

    expect(ErrorClassifier::classifyHttpError(503, 'down'))
        ->toBeInstanceOf(ProviderUnavailableError::class);
});

it('raises RateQuoteUnavailableError when the rate side is missing', function (): void {
    $http = new MockHttpClient([
        // Rate quote returns only the wrong side.
        ['status' => 'success', 'data' => ['buy' => ['rate' => '1']]],
    ]);
    $sender = new SenderClient($http->client());

    expect(fn () => $sender->createOfframpOrder([
        'amount' => '100',
        'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xabc'],
        'destination' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'recipient' => [
                'institution' => 'X',
                'accountIdentifier' => '1',
                'accountName' => 'Y',
                'memo' => 'm',
            ],
        ],
    ]))->toThrow(RateQuoteUnavailableError::class);
});

it('waitForStatus returns the order when target is reached', function (): void {
    $http = new MockHttpClient([
        ['status' => 'success', 'data' => ['id' => 'ord', 'status' => 'pending']],
        ['status' => 'success', 'data' => ['id' => 'ord', 'status' => 'fulfilling']],
        ['status' => 'success', 'data' => ['id' => 'ord', 'status' => 'settled']],
    ]);
    $sender = new SenderClient($http->client());
    $order = $sender->waitForStatus('ord', 'settled', new WaitForStatusOptions(pollMs: 1, timeoutMs: 2000));
    expect($order['status'])->toBe('settled');
});

it('waitForStatus accepts the terminal alias and times out when stuck', function (): void {
    // Terminal alias matches "expired".
    $expired = new MockHttpClient([
        ['status' => 'success', 'data' => ['id' => 'ord', 'status' => 'expired']],
    ]);
    $sender = new SenderClient($expired->client());
    expect($sender->waitForStatus('ord', 'terminal', new WaitForStatusOptions(pollMs: 1))['status'])->toBe('expired');

    // Stuck on pending — should time out into 408.
    $stuck = new MockHttpClient(array_fill(0, 10, ['status' => 'success', 'data' => ['id' => 'ord', 'status' => 'pending']]));
    $stuckSender = new SenderClient($stuck->client());
    expect(fn () => $stuckSender->waitForStatus('ord', 'settled', new WaitForStatusOptions(pollMs: 1, timeoutMs: 5)))
        ->toThrow(PaycrestApiError::class);
});

it('listOrders accepts a ListOrdersQuery value object', function (): void {
    $http = new MockHttpClient([
        ['status' => 'success', 'data' => ['orders' => []]],
    ]);
    $sender = new SenderClient($http->client());
    $sender->listOrders(new ListOrdersQuery(page: 2, pageSize: 50, status: 'settled'));
    expect($http->calls()[0]['query'])->toBe([
        'page' => 2,
        'pageSize' => 50,
        'status' => 'settled',
    ]);
});

it('listOrders keeps the legacy array signature working', function (): void {
    $http = new MockHttpClient([
        ['status' => 'success', 'data' => ['orders' => []]],
    ]);
    $sender = new SenderClient($http->client());
    $sender->listOrders(['page' => 1, 'pageSize' => 10]);
    expect($http->calls()[0]['query'])->toBe([
        'page' => 1,
        'pageSize' => 10,
    ]);
});
