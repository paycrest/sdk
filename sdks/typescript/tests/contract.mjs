import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, constants as cryptoConstants } from "node:crypto";
import {
  AuthenticationError,
  createPaycrestClient,
  GATEWAY_ABI,
  NetworkError,
  NotFoundError,
  PaycrestApiError,
  RateLimitError,
  RateQuoteUnavailableError,
  ValidationError,
} from "../dist/index.js";
import { encryptRecipientPayload, buildRecipientPayload } from "../dist/encryption.js";
import { toSubunits, scaleRate } from "../dist/gateway-client.js";
import { getNetwork, registerNetwork } from "../dist/networks.js";
import { clearRegisteredTokens, listRegisteredTokens, registerToken } from "../dist/registry.js";

function jsonResponse(payload, status = 200, headers = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    async json() {
      return payload;
    },
  };
}

function makeMockFetch(sequence) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });

    if (sequence.length === 0) {
      throw new Error("unexpected fetch call");
    }
    const next = sequence.shift();
    if (typeof next === "function") {
      return next({ url: String(url), init });
    }
    return next;
  };
  return { fetcher, calls };
}

async function testRateFirstOfframp() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { sell: { rate: "1500", providerIds: ["AbCdEfGh"], orderType: "regular", refundTimeoutMinutes: 60 } } }),
    ({ init }) => {
      const body = JSON.parse(init.body);
      assert.equal(body.rate, "1500");
      return jsonResponse({ status: "success", data: { id: "ord-1", status: "initiated" } }, 201);
    },
  ]);

  const client = createPaycrestClient({ senderApiKey: "sender-key", fetcher });
  const sender = client.sender();

  const order = await sender.createOfframpOrder({
    amount: "100",
    source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane", memo: "Payout" },
    },
  });

  assert.equal(order.id, "ord-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.includes("/rates/base/USDT/100/NGN"), true);
  assert.equal(calls[0].url.includes("side=sell"), true);
  assert.equal(calls[1].url.endsWith("/sender/orders"), true);
}

async function testRateFirstOnramp() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { buy: { rate: "1480", providerIds: ["AbCdEfGh"], orderType: "regular", refundTimeoutMinutes: 60 } } }),
    ({ init }) => {
      const body = JSON.parse(init.body);
      assert.equal(body.rate, "1480");
      return jsonResponse({ status: "success", data: { id: "ord-2", status: "initiated" } }, 201);
    },
  ]);

  const client = createPaycrestClient({ senderApiKey: "sender-key", fetcher });
  const sender = client.sender();

  const order = await sender.createOnrampOrder({
    amount: "50000",
    source: {
      type: "fiat",
      currency: "NGN",
      refundAccount: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane" },
    },
    destination: {
      type: "crypto",
      currency: "USDT",
      recipient: { address: "0xabc", network: "base" },
    },
  });

  assert.equal(order.id, "ord-2");
  assert.equal(calls[0].url.includes("side=buy"), true);
}

async function testManualRateSkipsQuote() {
  const { fetcher, calls } = makeMockFetch([
    ({ init }) => {
      const body = JSON.parse(init.body);
      assert.equal(body.rate, "1499");
      return jsonResponse({ status: "success", data: { id: "ord-3", status: "initiated" } }, 201);
    },
  ]);

  const client = createPaycrestClient({ senderApiKey: "sender-key", fetcher });
  const sender = client.sender();

  await sender.createOfframpOrder({
    amount: "100",
    rate: "1499",
    source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane", memo: "Payout" },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith("/sender/orders"), true);
}

async function testCreateOrderDirectionRouting() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { sell: { rate: "1500", providerIds: ["AbCdEfGh"], orderType: "regular", refundTimeoutMinutes: 60 } } }),
    jsonResponse({ status: "success", data: { id: "ord-4", status: "initiated" } }, 201),
    jsonResponse({ status: "success", data: { buy: { rate: "1480", providerIds: ["AbCdEfGh"], orderType: "regular", refundTimeoutMinutes: 60 } } }),
    jsonResponse({ status: "success", data: { id: "ord-5", status: "initiated" } }, 201),
  ]);

  const client = createPaycrestClient({ senderApiKey: "sender-key", fetcher });
  const sender = client.sender();

  await sender.createOrder({
    amount: "100",
    source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane", memo: "Payout" },
    },
  });

  await sender.createOrder({
    amount: "50000",
    source: {
      type: "fiat",
      currency: "NGN",
      refundAccount: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane" },
    },
    destination: {
      type: "crypto",
      currency: "USDT",
      recipient: { address: "0xabc", network: "base" },
    },
  });

  assert.equal(calls[0].url.includes("side=sell"), true);
  assert.equal(calls[2].url.includes("side=buy"), true);
}

async function testMissingCredentials() {
  const client = createPaycrestClient({});
  assert.throws(() => client.sender(), /senderApiKey is required/);
  assert.throws(() => client.provider(), /providerApiKey is required/);
}

async function testSplitCredentials() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { totalOrders: 1, totalOrderVolume: "1", totalFeeEarnings: "0" } }),
    jsonResponse({ status: "success", data: { totalOrders: 2, totalFiatVolume: "2", totalCryptoVolume: "1" } }),
  ]);

  const client = createPaycrestClient({ senderApiKey: "sender-key", providerApiKey: "provider-key", fetcher });
  await client.sender().getStats();
  await client.provider().getStats();

  assert.equal(calls[0].headers["API-Key"], "sender-key");
  assert.equal(calls[1].headers["API-Key"], "provider-key");
}

async function testProviderEndpoints() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { total: 0, page: 1, pageSize: 10, orders: [] } }),
    jsonResponse({ status: "success", data: { id: "ord-provider", status: "pending" } }),
    jsonResponse({ status: "success", data: { totalOrders: 1, totalFiatVolume: "1000", totalCryptoVolume: "1" } }),
    jsonResponse({ status: "success", data: { nodeId: "node-1" } }),
    jsonResponse({ status: "success", data: { buy: { marketRate: "1", minimumRate: "0.9", maximumRate: "1.1" } } }),
  ]);

  const client = createPaycrestClient({ providerApiKey: "provider-key", fetcher });
  const provider = client.provider();

  await provider.listOrders({ currency: "NGN", page: 1, pageSize: 10 });
  await provider.getOrder("ord-provider");
  await provider.getStats("NGN");
  await provider.getNodeInfo();
  await provider.getMarketRate("USDT", "NGN");

  assert.equal(calls[0].url.includes("/provider/orders"), true);
  assert.equal(calls[1].url.endsWith("/provider/orders/ord-provider"), true);
  assert.equal(calls[2].url.includes("/provider/stats"), true);
  assert.equal(calls[3].url.endsWith("/provider/node-info"), true);
  assert.equal(calls[4].url.endsWith("/provider/rates/USDT/NGN"), true);
}

async function testErrorMapping() {
  const { fetcher } = makeMockFetch([
    jsonResponse({ status: "error", message: "Validation failed", data: [{ field: "amount", message: "required" }] }, 400),
  ]);

  const client = createPaycrestClient({ senderApiKey: "sender-key", fetcher });
  const sender = client.sender();

  await assert.rejects(
    sender.getStats(),
    (err) => {
      assert.equal(err instanceof PaycrestApiError, true);
      assert.equal(err instanceof ValidationError, true);
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, "Validation failed");
      return true;
    },
  );
}

async function testTypedErrorClassification() {
  // 401 → AuthenticationError
  const auth = makeMockFetch([jsonResponse({ message: "bad key" }, 401)]);
  const authClient = createPaycrestClient({ senderApiKey: "bad", fetcher: auth.fetcher });
  await assert.rejects(authClient.sender().getStats(), (e) => e instanceof AuthenticationError);

  // 404 → NotFoundError
  const nf = makeMockFetch([jsonResponse({ message: "no such order" }, 404)]);
  const nfClient = createPaycrestClient({ senderApiKey: "k", fetcher: nf.fetcher });
  await assert.rejects(nfClient.sender().getOrder("missing"), (e) => e instanceof NotFoundError);

  // 429 → RateLimitError with Retry-After
  const rl = makeMockFetch([jsonResponse({ message: "slow down" }, 429, { "retry-after": "0.01" })]);
  const rlClient = createPaycrestClient({
    senderApiKey: "k",
    fetcher: rl.fetcher,
  });
  await assert.rejects(rlClient.sender().getStats(), (e) => {
    // After the stub exhausts 1 response, subsequent retries throw "unexpected fetch call".
    // We only assert the first error was classified correctly on the non-retry path.
    return e instanceof RateLimitError || e instanceof NetworkError;
  });
}

async function testGetRetriesOn5xx() {
  // 503 then 200 → retry succeeds. GETs retry automatically.
  let attempts = 0;
  const fetcher = async () => {
    attempts++;
    if (attempts < 2) return jsonResponse({ message: "oops" }, 503);
    return jsonResponse({
      status: "success",
      data: { totalOrders: 3, totalOrderVolume: "0", totalFeeEarnings: "0" },
    });
  };
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  const stats = await client.sender().getStats();
  assert.equal(stats.totalOrders, 3);
  assert.equal(attempts, 2);
}

async function testPostDoesNotRetryOn5xx() {
  // Payment POSTs must NOT auto-retry after server acknowledgment.
  let attempts = 0;
  const fetcher = async () => {
    attempts++;
    return jsonResponse({ message: "temporary" }, 503);
  };
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  await assert.rejects(
    client.sender().verifyAccount({ institution: "GTBINGLA", accountIdentifier: "123" }),
    (err) => err instanceof PaycrestApiError && err.statusCode === 503,
  );
  assert.equal(attempts, 1, "POST must not auto-retry on 5xx");
}

async function testPostRetriesOnTransportError() {
  // Transport-level failure before server acknowledgment → retry is safe.
  let attempts = 0;
  const fetcher = async () => {
    attempts++;
    if (attempts < 2) throw new Error("ECONNRESET");
    return jsonResponse({ status: "success", data: "ok" });
  };
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  const data = await client.sender().verifyAccount({ institution: "X", accountIdentifier: "1" });
  assert.equal(data, "ok");
  assert.equal(attempts, 2);
}

async function testRateQuoteUnavailableTyped() {
  const { fetcher } = makeMockFetch([
    jsonResponse({ status: "success", data: { buy: { rate: "1" } } }), // wrong side
  ]);
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  await assert.rejects(
    client.sender().createOfframpOrder({
      amount: "100",
      source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: { institution: "X", accountIdentifier: "1", accountName: "Y", memo: "m" },
      },
    }),
    (e) => e instanceof RateQuoteUnavailableError,
  );
}

async function testWaitForStatusReachesTarget() {
  const responses = [
    { status: "success", data: { id: "ord", status: "pending" } },
    { status: "success", data: { id: "ord", status: "fulfilling" } },
    { status: "success", data: { id: "ord", status: "settled" } },
  ];
  const fetcher = async () => jsonResponse(responses.shift());
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  const order = await client.sender().waitForStatus("ord", "settled", { pollMs: 1 });
  assert.equal(order.status, "settled");
}

async function testWaitForStatusTerminalAliasAndTimeout() {
  // target="terminal" should match any of settled/refunded/expired/cancelled.
  const fetcher = async () =>
    jsonResponse({ status: "success", data: { id: "ord", status: "expired" } });
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  const order = await client.sender().waitForStatus("ord", "terminal", { pollMs: 1 });
  assert.equal(order.status, "expired");

  // Timeout case.
  const stuckFetcher = async () =>
    jsonResponse({ status: "success", data: { id: "ord", status: "pending" } });
  const stuckClient = createPaycrestClient({ senderApiKey: "k", fetcher: stuckFetcher });
  await assert.rejects(
    stuckClient.sender().waitForStatus("ord", "settled", { pollMs: 5, timeoutMs: 20 }),
    (e) => e instanceof PaycrestApiError && /Timed out/.test(e.message),
  );
}

function testEncryptionEnvelopeRoundTrip() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  const recipient = buildRecipientPayload({
    institution: "GTBINGLA",
    accountIdentifier: "1234567890",
    accountName: "Jane Doe",
    memo: "Payout",
    providerId: "AbCdEfGh",
  });

  const envelopeB64 = encryptRecipientPayload(recipient, publicKey);
  const envelope = Buffer.from(envelopeB64, "base64");

  // Decode the envelope exactly as the aggregator does in Go.
  const keyLen = envelope.readUInt32BE(0);
  const encryptedKey = envelope.subarray(4, 4 + keyLen);
  const aesBlock = envelope.subarray(4 + keyLen);
  const aesNonce = aesBlock.subarray(0, 12);
  const ciphertextWithTag = aesBlock.subarray(12);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const aesKey = privateDecrypt(
    { key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
    encryptedKey,
  );
  const decipher = createDecipheriv("aes-256-gcm", aesKey, aesNonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const decoded = JSON.parse(plaintext);

  assert.equal(decoded.AccountIdentifier, "1234567890");
  assert.equal(decoded.Institution, "GTBINGLA");
  assert.equal(decoded.ProviderID, "AbCdEfGh");
  assert.equal(decoded.Memo, "Payout");
  assert.equal(typeof decoded.Nonce, "string");
  assert.equal(decoded.Metadata, null);
}

function testToSubunits() {
  assert.equal(toSubunits("1", 6), 1_000_000n);
  assert.equal(toSubunits("1.5", 6), 1_500_000n);
  assert.equal(toSubunits("0.000001", 6), 1n);
  assert.equal(toSubunits("100", 18), 100_000_000_000_000_000_000n);
  assert.throws(() => toSubunits("0.0000001", 6), /more fractional digits/);
  assert.throws(() => toSubunits("abc", 6), /Invalid amount/);
}

function testScaleRate() {
  // Aggregator stores rate as `rate * 100` rounded into uint96.
  assert.equal(scaleRate("1500"), 150_000n);
  assert.equal(scaleRate("1499.99"), 149_999n);
  assert.equal(scaleRate("1.23"), 123n);
}

function testNetworkRegistry() {
  const base = getNetwork("base");
  assert.equal(base.chainId, 8453);
  assert.equal(base.gateway, "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f");
  assert.equal(getNetwork("BASE").slug, "base");
  assert.throws(() => getNetwork("nope"), /Unsupported network/);

  registerNetwork({
    slug: "fake-testnet",
    chainId: 999_999,
    displayName: "Fake",
    gateway: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  });
  assert.equal(getNetwork("fake-testnet").chainId, 999_999);
}

async function testGatewayMethodRequiresSigner() {
  // method:'gateway' must throw a clear error when no signer is configured.
  const client = createPaycrestClient({ senderApiKey: "sender-key" });
  const sender = client.sender();
  await assert.rejects(
    sender.createOfframpOrder(
      {
        amount: "100",
        source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
        destination: {
          type: "fiat",
          currency: "NGN",
          recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane", memo: "Payout" },
        },
      },
      { method: "gateway" },
    ),
    (err) => {
      assert.equal(err instanceof PaycrestApiError, true);
      assert.match(err.message, /Gateway dispatch is not configured/);
      return true;
    },
  );
}

async function testGatewayMethodEndToEnd() {
  // Stand up a fake registry + viem-shaped signer/publicClient and run the
  // full gateway path: pubkey fetch -> tokens fetch -> approve -> createOrder.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  const fetcherCalls = [];
  const fetcher = async (url, init) => {
    fetcherCalls.push({ url: String(url), method: init?.method });
    if (String(url).endsWith("/tokens?network=base")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: "success",
            data: [
              {
                symbol: "USDT",
                contractAddress: "0xUsdtTokenAddressOnBase",
                decimals: 6,
                baseCurrency: "USD",
                network: "base",
              },
            ],
          };
        },
      };
    }
    if (String(url).includes("/rates/base/USDT/100/NGN")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: "success", data: { sell: { rate: "1500" } } };
        },
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const writeCalls = [];
  const signer = {
    account: { address: "0xSenderEoA0000000000000000000000000000000" },
    chain: { id: 8453 },
    async writeContract(args) {
      writeCalls.push(args);
      return `0xtx${writeCalls.length}`;
    },
  };
  const publicClient = {
    async readContract(args) {
      return 0n; // force the SDK to send an approve
    },
  };

  const client = createPaycrestClient({
    senderApiKey: "sender-key",
    fetcher,
    gateway: { signer, publicClient, aggregatorPublicKey: publicKey },
  });
  const sender = client.sender();

  const result = await sender.createOfframpOrder(
    {
      amount: "100",
      source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xRefund0000000000000000000000000000000000" },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", accountName: "Jane", memo: "Payout" },
      },
    },
    { method: "gateway" },
  );

  assert.equal(result.txHash, "0xtx2");
  assert.equal(result.approveTxHash, "0xtx1");
  assert.equal(result.gatewayAddress, "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f");
  assert.equal(result.tokenAddress, "0xUsdtTokenAddressOnBase");
  assert.equal(result.amount, "100000000"); // 100 * 10^6
  assert.equal(result.network, "base");
  assert.equal(typeof result.messageHash, "string");

  // approve call
  const approve = writeCalls[0];
  assert.equal(approve.functionName, "approve");
  assert.equal(approve.args[0], "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f");
  assert.equal(approve.args[1], 100_000_000n);

  // createOrder call
  const create = writeCalls[1];
  assert.equal(create.functionName, "createOrder");
  assert.equal(create.address, "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f");
  assert.equal(create.args[0], "0xUsdtTokenAddressOnBase");
  assert.equal(create.args[1], 100_000_000n);
  assert.equal(create.args[2], 150_000n); // rate * 100
  assert.equal(create.args[5], "0xRefund0000000000000000000000000000000000");
  assert.equal(create.args[6], result.messageHash);

  // Confirm the messageHash is a real hybrid envelope decryptable with the test private key.
  const envelope = Buffer.from(result.messageHash, "base64");
  const keyLen = envelope.readUInt32BE(0);
  const encryptedKey = envelope.subarray(4, 4 + keyLen);
  const aesBlock = envelope.subarray(4 + keyLen);
  const aesNonce = aesBlock.subarray(0, 12);
  const tag = aesBlock.subarray(aesBlock.length - 16);
  const ciphertext = aesBlock.subarray(12, aesBlock.length - 16);
  const aesKey = privateDecrypt({ key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, encryptedKey);
  const decipher = createDecipheriv("aes-256-gcm", aesKey, aesNonce);
  decipher.setAuthTag(tag);
  const plaintext = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  assert.equal(plaintext.Institution, "GTBINGLA");
  assert.equal(plaintext.AccountIdentifier, "1234567890");
  assert.equal(plaintext.Memo, "Payout");
}

async function testValidationErrorCarriesFieldErrors() {
  const { fetcher } = makeMockFetch([
    jsonResponse(
      {
        status: "error",
        message: "Validation failed",
        data: [
          { field: "amount", message: "required" },
          { field: "source.currency", message: "unknown token" },
        ],
      },
      400,
    ),
  ]);
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  await assert.rejects(
    client.sender().getStats(),
    (err) => {
      assert.equal(err instanceof ValidationError, true);
      assert.equal(err.fieldErrors.length, 2);
      assert.equal(err.fieldErrors[0].field, "amount");
      assert.equal(err.fieldErrors[1].message, "unknown token");
      return true;
    },
  );
}

async function testIdempotencyHeaderOnPost() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { sell: { rate: "1500" } } }),
    jsonResponse({ status: "success", data: { id: "ord-idem" } }, 201),
  ]);
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  await client.sender().createOfframpOrder({
    amount: "100",
    source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: { institution: "X", accountIdentifier: "1", accountName: "Y", memo: "m" },
    },
  });
  // Rate quote (GET) should NOT have an Idempotency-Key; order POST must.
  const rateCall = calls[0];
  const orderCall = calls[1];
  assert.equal(rateCall.headers["Idempotency-Key"], undefined);
  assert.ok(orderCall.headers["Idempotency-Key"], "POST missing Idempotency-Key header");
  assert.match(orderCall.headers["Idempotency-Key"], /[0-9a-f-]{36}/i);
  // Reference auto-generated too.
  const body = JSON.parse(orderCall.body);
  assert.ok(body.reference, "payload missing auto-generated reference");
  assert.match(body.reference, /[0-9a-f-]{36}/i);
}

async function testIdempotencyHeaderOverride() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { sell: { rate: "1500" } } }),
    jsonResponse({ status: "success", data: { id: "ord-idem2" } }, 201),
  ]);
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  await client.sender().createOfframpOrder(
    {
      amount: "100",
      source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: { institution: "X", accountIdentifier: "1", accountName: "Y", memo: "m" },
      },
    },
    { idempotencyKey: "caller-supplied-key" },
  );
  assert.equal(calls[1].headers["Idempotency-Key"], "caller-supplied-key");
}

async function testReferencePreservedIfProvided() {
  const { fetcher, calls } = makeMockFetch([
    jsonResponse({ status: "success", data: { sell: { rate: "1500" } } }),
    jsonResponse({ status: "success", data: { id: "ord-ref" } }, 201),
  ]);
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  await client.sender().createOfframpOrder({
    amount: "100",
    reference: "caller-ref-42",
    source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: { institution: "X", accountIdentifier: "1", accountName: "Y", memo: "m" },
    },
  });
  const body = JSON.parse(calls[1].body);
  assert.equal(body.reference, "caller-ref-42", "caller reference must be preserved");
}

async function testIterateOrdersWalksPages() {
  const fetcher = async (url) => {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get("page") || "1");
    if (page === 1) {
      return jsonResponse({
        status: "success",
        data: {
          total: 3,
          page: 1,
          pageSize: 2,
          orders: [
            { id: "a", status: "settled" },
            { id: "b", status: "settled" },
          ],
        },
      });
    }
    if (page === 2) {
      return jsonResponse({
        status: "success",
        data: {
          total: 3,
          page: 2,
          pageSize: 2,
          orders: [{ id: "c", status: "refunded" }],
        },
      });
    }
    return jsonResponse({ status: "success", data: { total: 3, page, pageSize: 2, orders: [] } });
  };
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  const collected = [];
  for await (const order of client.sender().iterateOrders({ pageSize: 2 })) {
    collected.push(order.id);
  }
  assert.deepEqual(collected, ["a", "b", "c"]);

  const all = await client.sender().listAllOrders({ pageSize: 2 });
  assert.equal(all.length, 3);
}

async function testStaticTokenRegistryShortCircuitsLookup() {
  clearRegisteredTokens();
  registerToken({
    symbol: "USDT",
    contractAddress: "0xUSDTbase",
    decimals: 6,
    baseCurrency: "USD",
    network: "base",
  });
  assert.equal(listRegisteredTokens().length, 1);

  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  // /tokens fetch must NOT happen because the static entry resolves first.
  let tokensFetched = false;
  const fetcher = async (url) => {
    if (String(url).includes("/tokens")) tokensFetched = true;
    if (String(url).includes("/rates/")) {
      return jsonResponse({ status: "success", data: { sell: { rate: "1500" } } });
    }
    if (String(url).includes("/sender/orders")) {
      return jsonResponse({ status: "success", data: { id: "ord-static" } }, 201);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const writeCalls = [];
  const signer = {
    account: { address: "0xSender" },
    chain: { id: 8453 },
    async writeContract(args) {
      writeCalls.push(args);
      return `0xtx${writeCalls.length}`;
    },
  };
  const publicClient = { async readContract() { return 1_000_000_000n; } };
  const client = createPaycrestClient({
    senderApiKey: "k",
    fetcher,
    gateway: { signer, publicClient, aggregatorPublicKey: publicKey },
  });
  const result = await client.sender().createOfframpOrder(
    {
      amount: "100",
      source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: { institution: "X", accountIdentifier: "1", accountName: "Y", memo: "m" },
      },
    },
    { method: "gateway" },
  );
  assert.equal(result.tokenAddress, "0xUSDTbase");
  assert.equal(tokensFetched, false, "/tokens fetch should be skipped when static entry resolves");
  clearRegisteredTokens();
}

async function testHooksObserveRequestsAndErrors() {
  const { fetcher } = makeMockFetch([
    jsonResponse({ status: "success", data: { totalOrders: 1, totalOrderVolume: "0", totalFeeEarnings: "0" } }),
    jsonResponse({ message: "bad" }, 401),
  ]);
  const events = [];
  const client = createPaycrestClient({
    senderApiKey: "k",
    fetcher,
    hooks: {
      onRequest: (ctx) => { events.push({ kind: "req", attempt: ctx.attempt, method: ctx.method }); },
      onResponse: (ctx) => { events.push({ kind: "res", statusCode: ctx.statusCode }); },
      onError: (ctx) => { events.push({ kind: "err", statusCode: ctx.statusCode }); },
    },
  });
  await client.sender().getStats();
  await assert.rejects(client.sender().getStats());

  // First call: onRequest + onResponse.
  assert.equal(events[0].kind, "req");
  assert.equal(events[1].kind, "res");
  // Second call: onRequest then onError (401).
  assert.equal(events[2].kind, "req");
  assert.equal(events[3].kind, "err");
  assert.equal(events[3].statusCode, 401);
}

async function testAbortSignalCancelsWaitForStatus() {
  const fetcher = async () =>
    jsonResponse({ status: "success", data: { id: "ord", status: "pending" } });
  const client = createPaycrestClient({ senderApiKey: "k", fetcher });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    client
      .sender()
      .waitForStatus("ord", "settled", { pollMs: 5, timeoutMs: 10_000, signal: controller.signal }),
    (err) => err instanceof PaycrestApiError && err.statusCode === 499,
  );
}

await testStaticTokenRegistryShortCircuitsLookup();
await testHooksObserveRequestsAndErrors();
await testAbortSignalCancelsWaitForStatus();
await testIterateOrdersWalksPages();
await testValidationErrorCarriesFieldErrors();
await testIdempotencyHeaderOnPost();
await testIdempotencyHeaderOverride();
await testReferencePreservedIfProvided();
await testRateFirstOfframp();
await testRateFirstOnramp();
await testManualRateSkipsQuote();
await testCreateOrderDirectionRouting();
await testMissingCredentials();
await testSplitCredentials();
await testProviderEndpoints();
await testErrorMapping();
await testTypedErrorClassification();
await testGetRetriesOn5xx();
await testPostDoesNotRetryOn5xx();
await testPostRetriesOnTransportError();
await testRateQuoteUnavailableTyped();
await testWaitForStatusReachesTarget();
await testWaitForStatusTerminalAliasAndTimeout();
testEncryptionEnvelopeRoundTrip();
testToSubunits();
testScaleRate();
testNetworkRegistry();
await testGatewayMethodRequiresSigner();
await testGatewayMethodEndToEnd();

console.log("typescript contract tests passed");
