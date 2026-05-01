# Changelog

All notable changes to the Paycrest SDK monorepo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html). Each language package may patch independently for ecosystem fixes, but wire-level / public-surface changes are tracked as a coordinated release.

## [Unreleased]

### Test gaps closed

- **Registry first-fetch TOCTOU fixed in Rust, Go, and Python.** All three previously had the `RLock → drop → Lock` window where N concurrent first-fetch callers would each issue a duplicate `/v2/tokens` (or `/v2/pubkey`) request. They now serialize the slow path through an async/sync mutex with a double-check after acquisition.
  - Rust: `tokio::sync::Mutex<()>` on `AggregatorRegistry`.
  - Go: `sync.Mutex` on `aggregatorRegistry.fetchMu`.
  - Python: `threading.Lock` on `AggregatorRegistry._fetch_lock`.
- **New regression tests** verify the fix end-to-end. Each language stands up an in-process counting HTTP fixture, fires 16 concurrent first-fetches, and asserts exactly 1 HTTP hit reached the server. Without the serializer the tests would observe 16 hits.
  - `sdks/rust/src/registry.rs::tests::concurrent_first_fetches_share_one_request` (uses `tokio::net::TcpListener`)
  - `sdks/go/sdk/registry_concurrency_test.go::TestRegistrySerializesConcurrentTokenFetches` + `…PubkeyFetches` (uses `httptest`, runs clean under `go test -race`)
  - `sdks/python/tests/test_registry_concurrency.py` (uses stdlib `http.server` + `concurrent.futures.ThreadPoolExecutor`)
- **Rust filled the bucket-3 test gaps** flagged in the previous review:
  - `list_all_orders_walks_pages` exercises pagination across three pages with a counting HTTP fixture and asserts the collector terminates correctly.
  - `request_hooks_fire_per_attempt` verifies the `RequestHooks` `on_request` / `on_response` / `on_error` callbacks fire in the right order across success and failure attempts.
  - Brings Rust contract test count from 12 → 17, total Rust tests from 17 → 20.
- **`HttpContext::new` widened from `fn new` to `pub(crate) fn new`** so registry-level concurrency tests can construct a minimal HTTP context without going through `PaycrestClient`.

### Pre-2.1 cleanup pass

- **Security**: Rust `verify_webhook_signature` now uses constant-time HMAC verification (`Mac::verify_slice`) instead of `==`. The other four SDKs were already constant-time (`crypto.timingSafeEqual`, `hmac.compare_digest`, `hmac.Equal`, `hash_equals`).
- **Correctness**: TS retry loop floors `policy.retries` to `1` so an explicit `retries: 0` no longer short-circuits to `"Unknown HTTP failure"` without ever calling fetch.
- **Correctness**: TS `onResponse` hook now reports the actual response status code (was hardcoded to `200`, dropping 201/202/204 signal for metrics consumers).
- **Correctness**: TS `waitForStatus` `sleepOrAbort` simplified to a single source of truth on abort — listener and timer just resolve, the loop's top-of-iteration check throws the typed 499 once.
- **Cross-SDK parity**: Rust now uses `ErrorKind::RateQuoteUnavailable` like the other four SDKs (was a separate `MissingRateQuote` enum variant). All five SDKs throw the same typed error with the same message format on missing rate quotes.
- **Cross-SDK parity**: "Gateway dispatch is not configured" wording now consistent across SDKs (capital G + period). Test assertions updated.
- **Type safety**: TS `gateway.signer` and `gateway.publicClient` now typed as `viem.WalletClient` / `viem.PublicClient` (were `any`). `GatewayPath` marked `@internal`.
- **Public surface**: Python `__all__` trimmed — `RecipientPayload`, `build_recipient_payload`, `encrypt_recipient_payload`, `AggregatorRegistry` no longer top-level exports (still importable via `paycrest_sdk.encryption` / `paycrest_sdk.registry`).
- **Public surface**: TS `WaitForStatusOptions.signal` doc corrected to say it throws a `PaycrestApiError` with `statusCode === 499` on abort (was incorrectly "throws a NetworkError").
- **Layout**: PHP `Uuid::v4()` extracted to `Paycrest\SDK\Support\Uuid` so `SenderClient` no longer reaches into `HttpClient` for it.
- **Layout**: PHP `SenderClient` no longer accepts a dead `$publicHttp` constructor argument.
- **Bazel**: dropped redundant `//sdks/laravel:contract` `sh_test` (was identical to `:smoke`).
- **Packaging**: `repository`, `homepage`, `bugs` / `support`, `keywords`, `categories`, `documentation` filled out across `package.json`, `pyproject.toml`, `Cargo.toml`, `composer.json`. TS dev deps pinned (no more `latest`). Each SDK directory now has its own README.
- **Docs**: `specs/openapi.yaml` bumped from `1.0.0` to `2.0.0` to match the shipping SDKs. README + `docs/sandbox-walkthrough.md` corrected to say the parity harness covers all 5 SDKs (Rust included since bucket 3).
- **Cleanup**: Parity driver no longer relies on curl URL-normalization (`$BASE_URL/../__reset` → `$SERVER_ROOT/__reset` etc.).
- **Cleanup**: removed stale unused imports from `paycrest_sdk/sender.py` (`Iterable`, `field`, `GatewayOrderResult`).

Deferred to a follow-up cleanup PR (tracked in the PR description): Go `CreateOfframpOrder` / `WithOpts` / `WithMethod` consolidation, Rust streaming pagination iterator + framework webhook middleware, registry TOCTOU on first-fetch (Rust/Go/Python), Python/PHP webhook helpers picking HTTP status by string-matching error messages.

### Added — bucket 3 (production polish)

- **Webhook framework middleware** for every language so integrators stop hand-rolling the same ten-line signature verifier:
  - TypeScript: `paycrestWebhook({ secret })` Express/Connect-shaped middleware + `parsePaycrestWebhook(rawBody, signature, secret)` framework-agnostic helper.
  - Python: `parse_paycrest_webhook` (stdlib), `fastapi_paycrest_webhook` dependency, `flask_paycrest_webhook` view decorator.
  - Go: `sdk.ParseWebhook(body, signature, secret)` + `sdk.WebhookHandler(...)` `net/http` handler.
  - Rust: `parse_webhook(raw, sig, secret)` framework-agnostic helper.
  - Laravel/PHP: `WebhookVerifier::parse(...)` + `VerifyPaycrestWebhook` middleware that attaches the parsed event to `$request->attributes`.
- **Forward-compatible client-side idempotency.** Every POST now ships an auto-generated `Idempotency-Key: <uuid>` header (caller-overridable) and the SDK auto-stamps a UUID `reference` on order payloads when one isn't supplied. Aggregator currently ignores the header but stores `reference`; resubmitting with the same `reference` is the dedup lever today.
- **`ValidationError.fieldErrors` / `field_errors` / `FieldErrors`.** The aggregator's `data: [{field, message}, ...]` payload is now lifted into a structured array on `ValidationError` so callers can wire it directly to form-field errors instead of inspecting `details`.
- **Pagination iterators.** `iterateOrders` / `iterate_orders` / `ForEachOrder` / `iterateOrders` Generator + `listAllOrders` / `list_all_orders` / `ListAllOrders` collectors, walking pages until empty or `total` is reached.
- **Cancellation parity.** TypeScript: `AbortSignal` accepted on requests and `waitForStatus`. Python / PHP: per-call `timeout` / `timeoutSeconds` override. Go / Rust already cancellable via `context.Context` / tokio.
- **Cross-SDK parity harness now covers Rust.** `scripts/tests/parity/rust-client/` builds a tiny cargo crate that runs the same off-ramp scenario; harness assertions stay green for all five SDKs.
- **Observation hooks.** `onRequest` / `onResponse` / `onError` callbacks on the HTTP client of every language, plumbed through `PaycrestClient` / `PaycrestClientOptions`. Hook exceptions are swallowed so a faulty tracer can never break SDK semantics.
- **Static token registry.** `registerToken(...)` / `register_token(...)` / `RegisterToken(...)` / `TokenRegistry::register(...)` lets operators pre-seed common tokens at startup; the gateway path resolves them with zero-RTT, falling back to the live `/v2/tokens` fetch when not registered. Includes `preload(network)` warmer.

### Changed

- `viem` moved from `peerDependencies` (optional) to `dependencies`. `npm install @paycrest/sdk` now installs everything needed for the gateway path — no more secondary `npm install viem` step.
- `RateQuoteSide` Rust struct fields default-initialize when missing (`providerIds`, `orderType`, `refundTimeoutMinutes`) so the deserializer doesn't choke on partial responses.

### Added — bucket 2 (rough edges)

- **Retry + backoff on every HTTP client.** GETs auto-retry on transport errors and `408/429/500/502/503/504` with exponential backoff plus jitter (capped at 10s); `Retry-After` is honored on 429. POSTs retry **only** on transport failures that precede server acknowledgment — auto-retrying acknowledged POSTs is unsafe for payment SDKs. Policy is overridable via `ClientOptions` / equivalent per language. (TS, Python, Go, Rust, PHP)
- **Typed error taxonomy.** `PaycrestApiError` / `PaycrestAPIError` / `PaycrestError` stays as the base; new subclasses / kinds let callers branch with `instanceof` (or `errors.Is` / `matches!` / `isinstance`) instead of string-matching: `ValidationError`, `AuthenticationError`, `NotFoundError`, `RateLimitError` (carries `retryAfterSeconds`), `ProviderUnavailableError`, `OrderRejectedError`, `RateQuoteUnavailableError`, `NetworkError`. Go exposes these as an `ErrorKind` enum on `APIError`; Rust as `ErrorKind` on `PaycrestError::Api`.
- **`waitForStatus(orderId, target, { pollMs?, timeoutMs? })`** on every sender client. `target` accepts a specific status, an array / list of statuses, or the literal `"terminal"` (any of settled / refunded / expired / cancelled). Defaults: 3 s poll, 5 min timeout. Throws a 408-classed error on timeout with the last-seen order attached.
- **Typed list-order filter objects** for Python (`ListOrdersQuery` / `ProviderListOrdersQuery`), Go (`ListOrdersQuery`; `ProviderListOrdersQuery` alias for `ProviderListOrdersParams`), and PHP (`Paycrest\SDK\Queries\ListOrdersQuery` / `ProviderListOrdersQuery`). Existing untyped signatures still work for backwards compatibility.
- **Cross-SDK parity harness** at `scripts/tests/parity/`. A Python-stdlib fixture server + per-SDK parity client (TS / Python / Go / PHP) replays the same off-ramp scenario (rate-first create → get) and asserts wire-level parity. Run `./scripts/tests/parity/run_parity.sh`.
- **CHANGELOG.md** (this file) and a **live sandbox walkthrough** in `docs/sandbox-walkthrough.md`.

### Changed
- Gateway dispatch errors and rate-side-missing errors now surface as typed `ValidationError` / `RateQuoteUnavailableError` respectively, not the generic `PaycrestApiError` base. Existing `catch (PaycrestApiError)` blocks continue to work unchanged.

## [2.0.0] — 2026-04-24

### Added
- **Direct-contract off-ramp** behind the existing `createOfframpOrder(payload, { method })` flag. `method: "gateway"` encrypts the recipient (hybrid AES-256-GCM + RSA-2048 PKCS1v15), ensures ERC-20 allowance, and broadcasts `Gateway.createOrder` from the configured signer. TypeScript uses viem directly; Python / Go / Rust / PHP delegate signing via a small `GatewayTransactor` interface.
- `/v2/pubkey` + `/v2/tokens` in-memory caches on every SDK.
- Network registry with bundled Gateway deployments for Base, Arbitrum One, BNB Smart Chain, Polygon, Scroll, Optimism, Celo, Lisk, Ethereum.

### Changed
- Standardized Packagist package to `paycrest/sdk` (previously `paycrest/sdk-laravel`). Go module path stays `github.com/paycrest/sdk-go` because Go modules require the module path to match the repo URL; all other languages land on the canonical `paycrest/sdk` identity.

See commit history for earlier changes.
