<?php

namespace Paycrest\SDK\Tests\Unit;

test('service provider resolves Paycrest client', function (): void {
    $client = app('paycrest-sdk');

    expect($client)->toBeInstanceOf(\Paycrest\SDK\Client\PaycrestClient::class);
});
