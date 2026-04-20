import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  const computed = Buffer.from(digest, "utf8");
  const incoming = Buffer.from(signature, "utf8");

  if (computed.length !== incoming.length) {
    return false;
  }
  return timingSafeEqual(computed, incoming);
}
