# Changelog

All notable changes to the Paycrest SDK monorepo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html). Each language package may patch independently for ecosystem fixes, but wire-level / public-surface changes are tracked as a coordinated release.

## [Unreleased]

### Added
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
