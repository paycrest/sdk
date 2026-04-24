import process from "node:process";
import { createPaycrestClient } from "../../../sdks/typescript/dist/index.js";

const baseUrl = process.env.PAYCREST_BASE_URL;
if (!baseUrl) {
  console.error("PAYCREST_BASE_URL is required");
  process.exit(1);
}

const client = createPaycrestClient({ senderApiKey: "parity-key", baseUrl });
const sender = client.sender();

const order = await sender.createOfframpOrder({
  amount: "100",
  source: { type: "crypto", currency: "USDT", network: "base", refundAddress: "0xabc" },
  destination: {
    type: "fiat",
    currency: "NGN",
    recipient: {
      institution: "GTBINGLA",
      accountIdentifier: "1234567890",
      accountName: "Jane Doe",
      memo: "Payout",
    },
  },
});
if (!order?.id) {
  console.error("ts-client: no order id returned");
  process.exit(2);
}
const refreshed = await sender.getOrder(order.id);
if (refreshed.status !== "settled") {
  console.error(`ts-client: unexpected status ${refreshed.status}`);
  process.exit(3);
}
console.log("ts-client: OK");
