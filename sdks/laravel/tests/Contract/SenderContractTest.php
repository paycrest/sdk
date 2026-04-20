<?php

declare(strict_types=1);

use Paycrest\SDK\Client\SenderClient;
use Paycrest\SDK\Tests\Support\MockHttpClient;

it('fetches sell quote before creating an offramp order', function (): void {
    $http = new MockHttpClient([
        static function (array $call): array {
            expect($call['method'])->toBe('GET');
            expect($call['path'])->toBe('/rates/base/USDT/100/NGN');
            expect($call['query'])->toBe(['side' => 'sell']);

            return [
                'status' => 'success',
                'data' => [
                    'sell' => ['rate' => '1500'],
                ],
            ];
        },
        static function (array $call): array {
            expect($call['method'])->toBe('POST');
            expect($call['path'])->toBe('/sender/orders');
            expect($call['body']['rate'])->toBe('1500');

            return [
                'status' => 'success',
                'data' => ['id' => 'ord-1', 'status' => 'initiated'],
            ];
        },
    ]);

    $sender = new SenderClient($http->client());
    $result = $sender->createOfframpOrder([
        'amount' => '100',
        'source' => [
            'type' => 'crypto',
            'currency' => 'USDT',
            'network' => 'base',
            'refundAddress' => '0xabc',
        ],
        'destination' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'recipient' => [
                'institution' => 'GTBINGLA',
                'accountIdentifier' => '1234567890',
                'accountName' => 'Jane',
                'memo' => 'Payout',
            ],
        ],
    ]);

    expect($result)->toMatchArray(['id' => 'ord-1']);
    expect($http->calls())->toHaveCount(2);
});

it('fetches buy quote before creating an onramp order', function (): void {
    $http = new MockHttpClient([
        static fn (): array => [
            'status' => 'success',
            'data' => [
                'buy' => ['rate' => '1480'],
            ],
        ],
        static function (array $call): array {
            expect($call['body']['rate'])->toBe('1480');

            return [
                'status' => 'success',
                'data' => ['id' => 'ord-2', 'status' => 'initiated'],
            ];
        },
    ]);

    $sender = new SenderClient($http->client());
    $result = $sender->createOnrampOrder([
        'amount' => '50000',
        'source' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'refundAccount' => [
                'institution' => 'GTBINGLA',
                'accountIdentifier' => '1234567890',
                'accountName' => 'Jane',
            ],
        ],
        'destination' => [
            'type' => 'crypto',
            'currency' => 'USDT',
            'recipient' => [
                'address' => '0xabc',
                'network' => 'base',
            ],
        ],
    ]);

    expect($result)->toMatchArray(['id' => 'ord-2']);
    expect($http->calls()[0]['query']['side'])->toBe('buy');
});

it('skips quote fetch when rate is provided manually', function (): void {
    $http = new MockHttpClient([
        static function (array $call): array {
            expect($call['path'])->toBe('/sender/orders');
            expect($call['body']['rate'])->toBe('1499');

            return [
                'status' => 'success',
                'data' => ['id' => 'ord-3'],
            ];
        },
    ]);

    $sender = new SenderClient($http->client());
    $sender->createOfframpOrder([
        'amount' => '100',
        'rate' => '1499',
        'source' => [
            'type' => 'crypto',
            'currency' => 'USDT',
            'network' => 'base',
            'refundAddress' => '0xabc',
        ],
        'destination' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'recipient' => [
                'institution' => 'GTBINGLA',
                'accountIdentifier' => '1234567890',
                'accountName' => 'Jane',
                'memo' => 'Payout',
            ],
        ],
    ]);

    expect($http->calls())->toHaveCount(1);
});

it('routes createOrder to offramp and onramp methods by direction', function (): void {
    $http = new MockHttpClient([
        static fn (): array => ['status' => 'success', 'data' => ['sell' => ['rate' => '1500']]],
        static fn (): array => ['status' => 'success', 'data' => ['id' => 'offramp']],
        static fn (): array => ['status' => 'success', 'data' => ['buy' => ['rate' => '1480']]],
        static fn (): array => ['status' => 'success', 'data' => ['id' => 'onramp']],
    ]);

    $sender = new SenderClient($http->client());

    $sender->createOrder([
        'amount' => '100',
        'source' => [
            'type' => 'crypto',
            'currency' => 'USDT',
            'network' => 'base',
            'refundAddress' => '0xabc',
        ],
        'destination' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'recipient' => [
                'institution' => 'GTBINGLA',
                'accountIdentifier' => '1234567890',
                'accountName' => 'Jane',
                'memo' => 'Payout',
            ],
        ],
    ]);

    $sender->createOrder([
        'amount' => '50000',
        'source' => [
            'type' => 'fiat',
            'currency' => 'NGN',
            'refundAccount' => [
                'institution' => 'GTBINGLA',
                'accountIdentifier' => '1234567890',
                'accountName' => 'Jane',
            ],
        ],
        'destination' => [
            'type' => 'crypto',
            'currency' => 'USDT',
            'recipient' => [
                'address' => '0xabc',
                'network' => 'base',
            ],
        ],
    ]);

    expect($http->calls()[0]['query']['side'])->toBe('sell');
    expect($http->calls()[2]['query']['side'])->toBe('buy');
});

it('throws when expected side quote is missing from response', function (): void {
    $http = new MockHttpClient([
        static fn (): array => [
            'status' => 'success',
            'data' => ['buy' => ['rate' => '1480']],
        ],
    ]);

    $sender = new SenderClient($http->client());

    expect(static function () use ($sender): void {
        $sender->createOfframpOrder([
            'amount' => '100',
            'source' => [
                'type' => 'crypto',
                'currency' => 'USDT',
                'network' => 'base',
                'refundAddress' => '0xabc',
            ],
            'destination' => [
                'type' => 'fiat',
                'currency' => 'NGN',
                'recipient' => [
                    'institution' => 'GTBINGLA',
                    'accountIdentifier' => '1234567890',
                    'accountName' => 'Jane',
                    'memo' => 'Payout',
                ],
            ],
        ]);
    })->toThrow(\RuntimeException::class, 'Unable to fetch sell rate for requested order.');
});
