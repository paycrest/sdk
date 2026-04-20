<?php

declare(strict_types=1);

use Paycrest\SDK\Client\PaycrestClient;

it('requires sender credentials when requesting sender client', function (): void {
    $client = new PaycrestClient(
        apiKey: null,
        senderApiKey: null,
        providerApiKey: 'provider-key',
        baseUrl: 'https://api.paycrest.io/v2',
    );

    expect(fn () => $client->sender())
        ->toThrow(\RuntimeException::class, 'senderApiKey (or apiKey) is required');
});

it('requires provider credentials when requesting provider client', function (): void {
    $client = new PaycrestClient(
        apiKey: null,
        senderApiKey: 'sender-key',
        providerApiKey: null,
        baseUrl: 'https://api.paycrest.io/v2',
    );

    expect(fn () => $client->provider())
        ->toThrow(\RuntimeException::class, 'providerApiKey (or apiKey) is required');
});
