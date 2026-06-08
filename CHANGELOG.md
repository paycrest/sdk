# Changelog

All notable changes to the Paycrest SDK monorepo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html). Each language package may patch independently for ecosystem fixes, but wire-level / public-surface changes are tracked as a coordinated release.

## [1.0.0] — 2026-06-08

First public release across all five SDKs — TypeScript (`@paycrest/sdk`), Python (`paycrest-sdk`), Go (`github.com/paycrest/sdk/sdks/go`), Rust (`paycrest-sdk`), Laravel/PHP (`paycrest/sdk`). Prior `2.x` tags in this repo were internal pre-release work that was never published to any registry.

### Sender & Provider API coverage

- Sender client: `createOfframpOrder`, `createOnrampOrder`, `getOrder`, `listOrders`, `getStats`, `getRate`, `verifyAccount`, `waitForStatus`.
- Provider client: `listOrders`, `getOrder`, `getStats`, `getNodeInfo`, `getMarketRate`.
- Pagination iterators (`iterateOrders` / `iterate_orders` / `ForEachOrder` Generator) + `listAllOrders` / `list_all_orders` / `ListAllOrders` collectors that walk pages until empty or `total` is reached.
- Typed list-order filter objects across Python, Go, and PHP (Existing untyped signatures still work).
- `waitForStatus(orderId, target, { pollMs?, timeoutMs? })` on every sender client. `target` accepts a specific status, an array / list of statuses, or the literal `"terminal"` (any of settled / refunded / expired / cancelled). Defaults: 3 s poll, 5 min timeout. Throws a 408-classed error on timeout with the last-seen order attached.

### Direct-contract off-ramp (Gateway)

- `createOfframpOrder(payload, { method: "gateway" })` encrypts the recipient (hybrid AES-256-GCM + RSA-2048 PKCS1v15), ensures ERC-20 allowance, and broadcasts `Gateway.createOrder` from the configured signer. TypeScript uses viem directly; Python / Go / Rust / PHP delegate signing via a small `GatewayTransactor` interface.
- Bundled network registry with Gateway deployments for Base, Arbitrum One, BNB Smart Chain, Polygon, Scroll, Optimism, Celo, Lisk, Ethereum.
- `/v2/pubkey` + `/v2/tokens` in-memory caches on every SDK, with first-fetch serialization (mutex + double-check) so N concurrent callers issue exactly one upstream request.
- Static token registry: `registerToken(...)` / `register_token(...)` / `RegisterToken(...)` / `TokenRegistry::register(...)` pre-seeds common tokens at startup; the gateway path resolves them with zero-RTT, falling back to the live `/v2/tokens` fetch when not registered. Includes `preload(network)` warmer.

### Webhook framework middleware

For every language so integrators stop hand-rolling the same ten-line signature verifier:

- TypeScript: `paycrestWebhook({ secret })` Express/Connect-shaped middleware + `parsePaycrestWebhook(rawBody, signature, secret)` framework-agnostic helper.
- Python: `parse_paycrest_webhook` (stdlib), `fastapi_paycrest_webhook` dependency, `flask_paycrest_webhook` view decorator.
- Go: `sdk.ParseWebhook(body, signature, secret)` + `sdk.WebhookHandler(...)` `net/http` handler.
- Rust: `parse_webhook(raw, sig, secret)` framework-agnostic helper.
- Laravel/PHP: `WebhookVerifier::parse(...)` + `VerifyPaycrestWebhook` middleware that attaches the parsed event to `$request->attributes`.

All five use constant-time HMAC verification.

### HTTP transport, errors, observability

- **Retry + backoff on every HTTP client.** GETs auto-retry on transport errors and `408/429/500/502/503/504` with exponential backoff plus jitter (capped at 10s); `Retry-After` is honored on 429. POSTs retry **only** on transport failures that precede server acknowledgment — auto-retrying acknowledged POSTs is unsafe for payment SDKs. Policy is overridable via `ClientOptions` / equivalent per language.
- **Typed error taxonomy.** `PaycrestApiError` / `PaycrestAPIError` / `PaycrestError` is the base; subclasses / kinds let callers branch with `instanceof` (or `errors.Is` / `matches!` / `isinstance`) instead of string-matching: `ValidationError` (carries `fieldErrors` / `field_errors` / `FieldErrors` lifted from the aggregator's `data: [{field, message}, ...]` payload), `AuthenticationError`, `NotFoundError`, `RateLimitError` (carries `retryAfterSeconds`), `ProviderUnavailableError`, `OrderRejectedError`, `RateQuoteUnavailableError`, `NetworkError`. Go exposes these as an `ErrorKind` enum on `APIError`; Rust as `ErrorKind` on `PaycrestError::Api`.
- **Observation hooks.** `onRequest` / `onResponse` / `onError` callbacks on every HTTP client, plumbed through `PaycrestClient` / `PaycrestClientOptions`. Hook exceptions are swallowed so a faulty tracer can never break SDK semantics.
- **Idempotency.** Every POST ships an auto-generated `Idempotency-Key: <uuid>` header (caller-overridable) and the SDK auto-stamps a UUID `reference` on order payloads when one isn't supplied.
- **Cancellation.** TypeScript: `AbortSignal` accepted on requests and `waitForStatus`. Python / PHP: per-call `timeout` / `timeoutSeconds` override. Go / Rust cancellable via `context.Context` / `tokio`.

### Cross-SDK parity harness

- `scripts/tests/parity/` runs a Python-stdlib fixture server + per-SDK parity client (TS / Python / Go / Rust / PHP) replaying the same off-ramp scenario (rate-first create → get) and asserting wire-level parity. Run `./scripts/tests/parity/run_parity.sh`.

### Packaging

- Packagist package: `paycrest/sdk` (canonical identity).
- Go module path: `github.com/paycrest/sdk/sdks/go` — subdirectory module so the SDK ships from this monorepo with one tag per release (`sdks/go/v<x.y.z>`), no mirror repo.
- `viem` ships as a direct dependency of `@paycrest/sdk` (not a peer dep), so `npm install @paycrest/sdk` installs everything needed for the gateway path.

See commit history for the full development trail.
