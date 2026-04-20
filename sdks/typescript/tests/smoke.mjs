import assert from "node:assert/strict";
import { verifyWebhookSignature } from "../dist/webhooks.js";

const body = JSON.stringify({ id: "abc", status: "settled" });
const secret = "paycrest-secret";
const crypto = await import("node:crypto");
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

assert.equal(verifyWebhookSignature(body, signature, secret), true);
assert.equal(verifyWebhookSignature(body, "invalid", secret), false);

console.log("typescript smoke test passed");
