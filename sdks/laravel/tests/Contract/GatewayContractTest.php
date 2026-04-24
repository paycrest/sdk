<?php

declare(strict_types=1);

use Paycrest\SDK\Gateway\Gateway;

it('builds a createOrder call with the expected shape', function (): void {
    $gateway = new Gateway('0x1111111111111111111111111111111111111111', 'base');
    $call = $gateway->buildCreateOrderCall([
        'token' => '0x2222222222222222222222222222222222222222',
        'amount' => '1000000',
        'rate' => '1500',
        'senderFeeRecipient' => '0x3333333333333333333333333333333333333333',
        'senderFee' => '0',
        'refundAddress' => '0x4444444444444444444444444444444444444444',
        'messageHash' => 'QmMessageCid',
    ]);

    expect($call['to'])->toBe('0x1111111111111111111111111111111111111111');
    expect($call['functionName'])->toBe('createOrder');
    expect($call['value'])->toBe('0');
    expect($call['abi'])->toBe(Gateway::ABI);
    expect($call['args'])->toBe([
        '0x2222222222222222222222222222222222222222',
        '1000000',
        '1500',
        '0x3333333333333333333333333333333333333333',
        '0',
        '0x4444444444444444444444444444444444444444',
        'QmMessageCid',
    ]);
});

it('resolves registered network addresses', function (): void {
    expect(fn () => Gateway::forNetwork('laravel-unknown-net'))
        ->toThrow(\InvalidArgumentException::class);

    Gateway::register('laravel-test-net', '0xABCDEF0000000000000000000000000000000000');
    $gateway = Gateway::forNetwork('laravel-test-net');
    expect($gateway->address)->toBe('0xABCDEF0000000000000000000000000000000000');
    expect(Gateway::addressFor('laravel-test-net'))
        ->toBe('0xABCDEF0000000000000000000000000000000000');
});

it('builds a getOrderInfo call', function (): void {
    $gateway = new Gateway('0x1111111111111111111111111111111111111111');
    $call = $gateway->buildGetOrderInfoCall(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
    );

    expect($call['functionName'])->toBe('getOrderInfo');
    expect($call['args'])->toBe([
        '0x0000000000000000000000000000000000000000000000000000000000000001',
    ]);
});

it('rejects an empty contract address', function (): void {
    expect(fn () => new Gateway(''))
        ->toThrow(\InvalidArgumentException::class);
});

it('rejects createOrder calls missing required params', function (): void {
    $gateway = new Gateway('0x1111111111111111111111111111111111111111');
    expect(fn () => $gateway->buildCreateOrderCall([
        'token' => '0x2222222222222222222222222222222222222222',
    ]))->toThrow(\InvalidArgumentException::class);
});
