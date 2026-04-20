<?php

use Paycrest\SDK\Client\ProviderClient;
use Paycrest\SDK\Tests\Support\MockHttpClient;

it('maps provider endpoints and query arguments', function (): void {
    $http = new MockHttpClient([
        ['status' => 'success', 'data' => ['total' => 0, 'orders' => []]],
        ['status' => 'success', 'data' => ['id' => 'ord-provider']],
        ['status' => 'success', 'data' => ['totalOrders' => 2]],
        ['status' => 'success', 'data' => ['nodeId' => 'node-1']],
        ['status' => 'success', 'data' => ['buy' => ['marketRate' => '1']]],
    ]);
    $provider = new ProviderClient($http);

    $provider->listOrders([
        'currency' => 'NGN',
        'page' => 2,
        'pageSize' => 5,
        'status' => 'pending',
        'ordering' => 'desc',
    ]);
    $provider->getOrder('ord-provider');
    $provider->getStats('NGN');
    $provider->getNodeInfo();
    $provider->getMarketRate('USDT', 'NGN');

    expect($http->calls())->toHaveCount(5);
    expect($http->calls()[0]['path'])->toBe('/provider/orders');
    expect($http->calls()[0]['query']['currency'])->toBe('NGN');
    expect($http->calls()[1]['path'])->toBe('/provider/orders/ord-provider');
    expect($http->calls()[2]['path'])->toBe('/provider/stats');
    expect($http->calls()[3]['path'])->toBe('/provider/node-info');
    expect($http->calls()[4]['path'])->toBe('/provider/rates/USDT/NGN');
});

it('defaults provider list orders paging values', function (): void {
    $http = new MockHttpClient([
        ['status' => 'success', 'data' => ['total' => 0, 'orders' => []]],
    ]);
    $provider = new ProviderClient($http);

    $provider->listOrders([
        'currency' => 'NGN',
    ]);

    expect($http->calls())->toHaveCount(1);
    expect($http->calls()[0]['query']['page'])->toBe(1);
    expect($http->calls()[0]['query']['pageSize'])->toBe(10);
});
