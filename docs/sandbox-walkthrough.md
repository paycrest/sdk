# Live Sandbox Walkthrough

End-to-end guide for validating an SDK against a real Paycrest API deployment. Use this once you've picked up an API key; it's the
quickest way to confirm rate-first behavior, wire formats, and webhook signatures before wiring the SDK into production code.

## 1. Get credentials

You need:

| Variable | Purpose |
| --- | --- |
| `PAYCREST_SENDER_API_KEY` | Sender operations: `/sender/orders`, `/sender/stats`, rate quotes. |
| `PAYCREST_PROVIDER_API_KEY` | Provider operations: `/provider/orders`, `/provider/stats`, market rate bands. Optional if you're only testing sender flows. |
| `PAYCREST_BASE_URL` | Defaults to `https://api.paycrest.io/v2`. Override for staging. |
| `PAYCREST_NETWORK` / `PAYCREST_TOKEN` / `PAYCREST_FIAT` / `PAYCREST_AMOUNT` | Scenario parameters for the Go integration probe (see below). |

Keep credentials in your shell profile or a `.env` loaded only in your dev shell — **never commit them**.

## 2. Run the integration probes

Each SDK has a small live-API probe under `scripts/tests/integration_*.sh`. The probes are safe by default: if required env vars are
missing they exit successfully with a "skipping" message so you can run them in any environment.

```bash
# Run every language's probe (skips any that lack credentials)
./scripts/tests/run_all_integration.sh

# Or pick one language at a time
./scripts/tests/integration_typescript.sh
./scripts/tests/integration_python.sh
./scripts/tests/integration_go.sh
./scripts/tests/integration_rust.sh
./scripts/tests/integration_laravel.sh
```

A successful sender probe looks roughly like:

```text
typescript sender integration check passed (totalOrders=42)
python sender integration check passed
go integration passed: senderStats=42 providerStats=7 sellRate=1500
rust integration passed (sender.total_orders=42, provider.total_orders=7)
Laravel sender integration check passed
```

## 3. Sanity-check the full off-ramp path (safe, no real funds)

The off-ramp **API** path (default) is read-only against the aggregator until you POST to `/sender/orders`. These two commands exercise the sensitive bits of the flow without creating a real order:

```bash
# Rate quote — should return both `buy` and `sell` rate sides for the pair.
curl -sS -H "API-Key: $PAYCREST_SENDER_API_KEY" \
  "$PAYCREST_BASE_URL/rates/base/USDT/100/NGN?side=sell"

# Aggregator RSA public key (used by the gateway dispatch path).
curl -sS "$PAYCREST_BASE_URL/pubkey"
```

If both return `"status":"success"` you're wired correctly.

## 4. First real order (sender, off-ramp)

Pick any SDK. The snippet below is TypeScript; Python / Go / Rust / PHP are equivalent — method names only differ by language
convention.

```ts
import { createPaycrestClient } from "@paycrest/sdk";

const client = createPaycrestClient({
  senderApiKey: process.env.PAYCREST_SENDER_API_KEY!,
});
const sender = client.sender();

const order = await sender.createOfframpOrder({
  amount: "1",                                   // start tiny
  source: { type: "crypto", currency: "USDT", network: "base", refundAddress: process.env.REFUND_ADDRESS! },
  destination: {
    type: "fiat",
    currency: "NGN",
    recipient: {
      institution: "GTBINGLA",
      accountIdentifier: "0000000000",            // valid test account
      accountName: "Sandbox",
      memo: "SDK sandbox walkthrough",
    },
  },
});
console.log("receive to:", order.providerAccount?.receiveAddress);

// Poll until terminal — new in this release.
const final = await sender.waitForStatus(order.id, "terminal", { pollMs: 5_000, timeoutMs: 10 * 60_000 });
console.log("final status:", final.status);
```

## 5. Webhook verification sanity check

All SDKs expose the same helper. Replace `RAW_BODY`, `SIG`, and `SECRET` with real values from an incoming webhook:

```ts
import { verifyWebhookSignature } from "@paycrest/sdk";

const ok = verifyWebhookSignature(RAW_BODY, SIG, SECRET);
if (!ok) throw new Error("invalid signature");
```

## 6. Cross-SDK parity (optional)

If you're integrating multiple SDKs at once (monorepo polyglot, mobile + backend), confirm they produce identical HTTP traffic with the fixture harness:

```bash
./scripts/tests/parity/run_parity.sh
```

The harness stands up a tiny Python fixture server on a random localhost port and replays the same off-ramp scenario through the
TypeScript / Python / Go / PHP SDKs. A mismatch between any two SDKs fails the harness loudly and prints the offending request.

## 7. GitHub Actions

Every probe also runs in CI as a manual (`workflow_dispatch`) job — see `.github/workflows/integration.yml`. Set the required
secrets in the repo settings to let the workflow run against the live API.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `AuthenticationError` on the very first call | API-Key missing or wrong for that profile (sender vs. provider). |
| `RateQuoteUnavailableError` on create-offramp | Fiat / network / token trio doesn't have an active provider; verify with `/v2/rates/...`. |
| `RateLimitError` with `retryAfterSeconds` set | You're hitting the shared limit — the SDK auto-retries on GETs; throttle your POSTs. |
| `waitForStatus` throws `408` | Order never reached the target before the timeout. Bump `timeoutMs` or pass `"terminal"` to stop on any terminal state. |
| Gateway dispatch raises `ValidationError: Gateway dispatch is not configured` | `gateway: { signer, publicClient }` was not passed when constructing `PaycrestClient`. |
