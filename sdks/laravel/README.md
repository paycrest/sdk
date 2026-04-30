# paycrest/sdk (PHP / Laravel)

Official Paycrest SDK for PHP and Laravel — sender, provider, and direct on-chain off-ramp via the Paycrest Gateway contract.

## Install

```bash
composer require paycrest/sdk
```

## Quickstart (Laravel)

```php
use Paycrest\SDK\Client\PaycrestClient;

$client = app(PaycrestClient::class);

$order = $client->sender()->createOfframpOrder([
    'amount' => '100',
    'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xabc...'],
    'destination' => [
        'type' => 'fiat',
        'currency' => 'NGN',
        'recipient' => [
            'institution' => 'GTBINGLA',
            'accountIdentifier' => '1234567890',
            'accountName' => 'Jane Doe',
            'memo' => 'Invoice 42',
        ],
    ],
]);
```

## Webhook verification (middleware)

```php
use Paycrest\SDK\Webhooks\VerifyPaycrestWebhook;

Route::post('/webhooks/paycrest', WebhookHandlerController::class)
    ->middleware(VerifyPaycrestWebhook::class);
```

In your handler, read the verified event from `$request->attributes->get('paycrest_event')`.

## Direct-contract off-ramp

Pass a `GatewayTransactor` implementation when constructing `PaycrestClient` and call `createOfframpOrder($payload, method: 'gateway')`. See `examples/offramp_gateway.php`.

## Full docs

- Repository: <https://github.com/paycrest/sdk>
- Step-by-step walkthrough: <https://github.com/paycrest/sdk/blob/main/docs/sandbox-walkthrough.md>
- Aggregator API reference: <https://docs.paycrest.io>

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`).
