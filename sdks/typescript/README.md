# @paycrest/sdk

Official Paycrest SDK for TypeScript / JavaScript — sender, provider, and direct on-chain off-ramp via the Paycrest Gateway contract.

## Install

```bash
npm install @paycrest/sdk
```

(Includes `viem` for the direct-contract off-ramp path. No other peer dependency.)

## Quickstart

```ts
import { createPaycrestClient } from "@paycrest/sdk";

const client = createPaycrestClient({
  senderApiKey: process.env.PAYCREST_SENDER_API_KEY!,
});

const order = await client.sender().createOfframpOrder({
  amount: "100",
  source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc..." },
  destination: {
    type: "fiat",
    currency: "NGN",
    recipient: {
      institution: "GTBINGLA",
      accountIdentifier: "1234567890",
      accountName: "Jane Doe",
      memo: "Invoice 42",
    },
  },
});

console.log(order.providerAccount?.receiveAddress);

const final = await client.sender().waitForStatus(order.id, "terminal");
console.log(final.status);
```

## Direct-contract off-ramp (viem)

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const account = privateKeyToAccount(process.env.SIGNER_PRIVATE_KEY! as `0x${string}`);
const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL!) });
const publicClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL!) });

const client = createPaycrestClient({
  senderApiKey: process.env.PAYCREST_SENDER_API_KEY!,
  gateway: { signer: walletClient, publicClient },
});

const result = await client.sender().createOfframpOrder(payload, { method: "gateway" });
console.log(result.txHash, result.approveTxHash);
```

## Webhook verification

```ts
import { paycrestWebhook } from "@paycrest/sdk";
import express from "express";

const app = express();
app.post(
  "/webhooks/paycrest",
  paycrestWebhook({ secret: process.env.PAYCREST_WEBHOOK_SECRET! }),
  (req, res) => {
    console.log(req.paycrestEvent!.data.status);
    res.status(200).end();
  },
);
```

## Full docs

- Repository: <https://github.com/paycrest/sdk>
- Step-by-step walkthrough: <https://github.com/paycrest/sdk/blob/main/docs/sandbox-walkthrough.md>
- Aggregator API reference: <https://docs.paycrest.io>

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`).
