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

- `sender.createOrder(payload)`
- `sender.listOrders({ page, pageSize, status })`
- `sender.getOrder(orderId)`
- `sender.getStats()`
- `sender.verifyAccount({ institution, accountIdentifier })`
- `verifyWebhookSignature(rawBody, signature, secret)`

## API defaults

- Base URL: `https://api.paycrest.io/v2`
- Auth header: `API-Key: <YOUR_API_KEY>`
- Content-Type: `application/json`

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

## Quick usage examples

### TypeScript

```ts
import { createPaycrestClient } from "@paycrest/sdk";

const client = createPaycrestClient({ apiKey: process.env.PAYCREST_API_KEY! });
const stats = await client.sender().getStats();
console.log(stats);
```

### Python

```python
from paycrest_sdk import PaycrestClient

client = PaycrestClient(api_key="YOUR_API_KEY")
print(client.sender().get_stats())
```

### Go

```go
client := sdk.NewClient("YOUR_API_KEY", sdk.DefaultBaseURL)
stats, err := client.Sender().GetStats(context.Background())
```

### Rust

```rust
let client = paycrest_sdk::PaycrestClient::new("YOUR_API_KEY");
let stats = client.sender().get_stats().await?;
```

### Laravel

```php
$stats = app(\Paycrest\SDK\Client\PaycrestClient::class)
    ->sender()
    ->getStats();
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
