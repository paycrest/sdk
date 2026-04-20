# Paycrest SDK Monorepo (Bazel, Sender API v2)

Multi-language SDK monorepo for the Paycrest **Sender API v2** (`https://api.paycrest.io/v2`), designed to publish first-class clients for:

- TypeScript (`@paycrest/sdk`)
- Python (`paycrest-sdk`)
- Go (`github.com/paycrest/sdk-go`)
- Rust (`paycrest-sdk`)
- Laravel / PHP (`paycrest/sdk-laravel`)

v2 scope today is **Sender**. The repository structure intentionally supports future expansion for provider and other protocol parties.

## Design goals

- One canonical sender v2 contract: `specs/sender-v2.openapi.yaml`
- Consistent method surface across all languages
- Bazel-first orchestration for smoke checks
- Independent, ecosystem-native release flows

## Repository layout

```text
.
├── BUILD.bazel
├── MODULE.bazel
├── specs/
│   └── sender-v2.openapi.yaml
├── docs/
│   └── release-playbook.md
├── scripts/
│   ├── tests/
│   └── release/
└── sdks/
    ├── typescript/
    ├── python/
    ├── go/
    ├── rust/
    └── laravel/
```

## Shared SDK surface (Sender v2)

Every language SDK exposes the same sender primitives:

- `sender.createOrder(payload)` (auto-detects onramp/offramp)
- `sender.createOfframpOrder(payload)`
- `sender.createOnrampOrder(payload)`
- `sender.listOrders({ page, pageSize, status })`
- `sender.getOrder(orderId)`
- `sender.getStats()`
- `sender.verifyAccount({ institution, accountIdentifier })`
- `sender.getTokenRate({ network, token, amount, fiat, side })`
- `verifyWebhookSignature(rawBody, signature, secret)`

## API defaults

- Base URL: `https://api.paycrest.io/v2`
- Auth header: `API-Key: <YOUR_API_KEY>`
- Content-Type: `application/json`

## Rate-first order creation (important)

For sender flows, SDKs now default to **rate-first** behavior:

- If `rate` is omitted in create-order payloads, the SDK first calls `GET /rates/{network}/{token}/{amount}/{fiat}`.
- It uses `side=sell` for offramp and `side=buy` for onramp, then injects the returned rate into `POST /sender/orders`.
- This reduces refund risk from stale/manual rates and improves provider match likelihood.

Manual `rate` override is still supported, but not recommended for normal integrations.

## Sender vs provider authentication

Authentication may differ between sender and provider identities. SDKs support separate initialization keys:

- TypeScript: `senderApiKey`, `providerApiKey` (or shared `apiKey`)
- Python: `sender_api_key`, `provider_api_key` (or shared `api_key`)
- Go: `ClientOptions{SenderAPIKey, ProviderAPIKey}`
- Rust: `ClientOptions { sender_api_key, provider_api_key }`
- Laravel: `PAYCREST_SENDER_API_KEY`, `PAYCREST_PROVIDER_API_KEY`

## Build and test with Bazel

```bash
# all smoke targets
bazel test //...

# per-language smoke targets
bazel test //sdks/typescript:smoke
bazel test //sdks/python:smoke
bazel test //sdks/go:smoke
bazel test //sdks/rust:smoke
bazel test //sdks/laravel:smoke
```

If Bazel is not installed:

```bash
npm i -g @bazel/bazelisk
bazelisk test //...
```

## Cloud agent environment setup

Cloud agents for this repository are expected to run with a repo-level environment config at `.cursor/environment.json`.

The install step uses `.cursor/scripts/install-cloud-toolchains.sh` to provision baseline tooling so smoke tests run without manual bootstrap:

- `go1.26.0` available on `PATH`
- Rust stable toolchain with `rustfmt` and `clippy`
- default `node`/`npm` binaries

You can validate the environment by running:

```bash
./scripts/tests/run_all_smoke.sh
```

## Quick usage examples

### TypeScript

```ts
import { createPaycrestClient } from "@paycrest/sdk";

const client = createPaycrestClient({
  senderApiKey: process.env.PAYCREST_SENDER_API_KEY!,
  providerApiKey: process.env.PAYCREST_PROVIDER_API_KEY,
});

const order = await client.sender().createOfframpOrder({
  amount: "100",
  source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
  destination: {
    type: "fiat",
    currency: "NGN",
    recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "John", memo: "Payout" },
  },
});

console.log(order);
```

### Python

```python
from paycrest_sdk import PaycrestClient

client = PaycrestClient(sender_api_key="SENDER_KEY")
order = client.sender().create_offramp_order({
    "amount": "100",
    "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
    "destination": {
        "type": "fiat",
        "currency": "NGN",
        "recipient": {"institution": "GTBINGLA", "accountIdentifier": "1234567890", "accountName": "John", "memo": "Payout"}
    }
})
print(order)
```

### Go

```go
client := sdk.NewClientWithOptions(sdk.ClientOptions{
    SenderAPIKey: "SENDER_KEY",
    BaseURL: sdk.DefaultBaseURL,
})
sender, _ := client.Sender()
stats, err := sender.GetStats(context.Background())
```

### Rust

```rust
let client = paycrest_sdk::PaycrestClient::new_with_options(paycrest_sdk::client::ClientOptions {
    sender_api_key: Some("SENDER_KEY".to_string()),
    ..Default::default()
});
let sender = client.sender()?;
let stats = sender.get_stats().await?;
```

### Laravel

```php
$client = app(\Paycrest\SDK\Client\PaycrestClient::class);
$order = $client->sender()->createOfframpOrder([
    'amount' => '100',
    'source' => ['type' => 'crypto', 'currency' => 'USDT', 'network' => 'base', 'refundAddress' => '0xabc'],
    'destination' => [
        'type' => 'fiat',
        'currency' => 'NGN',
        'recipient' => ['institution' => 'GTBINGLA', 'accountIdentifier' => '1234567890', 'accountName' => 'John', 'memo' => 'Payout']
    ],
]);
```

## Deployment guide to each SDK repository

Use this monorepo as source-of-truth, then mirror each SDK folder to its dedicated public repository.

### 1) TypeScript repository deployment (`paycrest/sdk-typescript`)

```bash
./scripts/release/release_typescript.sh 2.0.0
git subtree split --prefix=sdks/typescript -b release/typescript
# push release/typescript branch to paycrest/sdk-typescript
```

Then tag and release in the TypeScript repository.

### 2) Python repository deployment (`paycrest/sdk-python`)

```bash
./scripts/release/release_python.sh 2.0.0
git subtree split --prefix=sdks/python -b release/python
# push release/python branch to paycrest/sdk-python
```

Then tag and publish to PyPI in the Python repository pipeline.

### 3) Go repository deployment (`paycrest/sdk-go`)

```bash
./scripts/release/release_go.sh 2.0.0
git subtree split --prefix=sdks/go -b release/go
# push release/go branch to paycrest/sdk-go
```

In `sdk-go`, create and push tag `v2.0.0`.

### 4) Rust repository deployment (`paycrest/sdk-rust`)

```bash
./scripts/release/release_rust.sh 2.0.0
git subtree split --prefix=sdks/rust -b release/rust
# push release/rust branch to paycrest/sdk-rust
```

Then create release tag and publish to crates.io from the Rust repository.

### 5) Laravel repository deployment (`paycrest/sdk-laravel`)

```bash
./scripts/release/release_laravel.sh 2.0.0
git subtree split --prefix=sdks/laravel -b release/laravel
# push release/laravel branch to paycrest/sdk-laravel
```

Then tag `v2.0.0` and ensure Packagist syncs that tag.

## Coordinated multi-language release

```bash
./scripts/release/release_all.sh 2.0.0
```

After this command, mirror each subtree and publish in the target package ecosystem.

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`).
