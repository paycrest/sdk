import { createCipheriv, publicEncrypt, randomBytes, constants } from "node:crypto";

/**
 * Recipient details encrypted into the on-chain `messageHash` field.
 * Field names + ordering match the aggregator's
 * `crypto.EncryptOrderRecipient` payload struct exactly.
 */
export interface RecipientPayload {
  Nonce: string;
  AccountIdentifier: string;
  AccountName: string;
  Institution: string;
  ProviderID: string;
  Memo: string;
  Metadata: Record<string, unknown> | null;
}

/**
 * Hybrid AES-256-GCM + RSA-2048-PKCS1v15 envelope used by the Paycrest
 * aggregator. Layout (big-endian):
 *
 *   [4 bytes: encrypted-AES-key length]
 *   [encrypted-AES-key bytes]
 *   [12-byte AES-GCM nonce]
 *   [AES-GCM ciphertext]
 *   [16-byte AES-GCM auth tag]
 *
 * Result is base64-encoded and passed as the contract's `messageHash`
 * argument. Matches `utils/crypto/crypto.go::encryptHybridJSON` in the
 * aggregator repo.
 */
export function encryptRecipientPayload(
  payload: RecipientPayload,
  publicKeyPEM: string,
): string {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");

  const aesKey = randomBytes(32);
  const aesNonce = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", aesKey, aesNonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedKey = publicEncrypt(
    {
      key: publicKeyPEM,
      padding: constants.RSA_PKCS1_PADDING,
    },
    aesKey,
  );

  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32BE(encryptedKey.length, 0);

  const envelope = Buffer.concat([
    lenPrefix,
    encryptedKey,
    aesNonce,
    ciphertext,
    authTag,
  ]);

  return envelope.toString("base64");
}

/**
 * Build the recipient payload from a sender-facing offramp recipient
 * description. `providerId` and `metadata` are optional and default to
 * the aggregator's expected empty representations.
 */
export function buildRecipientPayload(input: {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo: string;
  providerId?: string;
  metadata?: Record<string, unknown> | null;
}): RecipientPayload {
  return {
    Nonce: randomBytes(12).toString("base64"),
    AccountIdentifier: input.accountIdentifier,
    AccountName: input.accountName,
    Institution: input.institution,
    ProviderID: input.providerId ?? "",
    Memo: input.memo,
    Metadata: input.metadata ?? null,
  };
}
