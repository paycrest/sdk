import assert from "node:assert/strict";
import { createPaycrestClient, PaycrestApiError } from "../dist/index.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
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
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, "Validation failed");
      return true;
    },
  );
}

await testRateFirstOfframp();
await testRateFirstOnramp();
await testManualRateSkipsQuote();
await testCreateOrderDirectionRouting();
await testMissingCredentials();
await testSplitCredentials();
await testProviderEndpoints();
await testErrorMapping();

console.log("typescript contract tests passed");
