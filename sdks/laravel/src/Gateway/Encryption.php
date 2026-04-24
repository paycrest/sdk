<?php

declare(strict_types=1);

namespace Paycrest\SDK\Gateway;

use RuntimeException;

/**
 * Hybrid AES-256-GCM + RSA-2048 recipient encryption.
 *
 * Byte-for-byte compatible with `aggregator/utils/crypto/crypto.go::encryptHybridJSON`.
 * Envelope layout (base64-encoded):
 *
 *   [4 bytes BE: encrypted-AES-key length]
 *   [encrypted-AES-key bytes]
 *   [12-byte AES-GCM nonce]
 *   [AES-GCM ciphertext][16-byte auth tag]
 */
final class Encryption
{
    /**
     * @param array{
     *   institution:string,
     *   accountIdentifier:string,
     *   accountName:string,
     *   memo:string,
     *   providerId?:string,
     *   metadata?:array<string,mixed>|null
     * } $input
     * @return array{
     *   Nonce:string,
     *   AccountIdentifier:string,
     *   AccountName:string,
     *   Institution:string,
     *   ProviderID:string,
     *   Memo:string,
     *   Metadata:array<string,mixed>|null
     * }
     */
    public static function buildRecipientPayload(array $input): array
    {
        $nonceBytes = random_bytes(12);
        return [
            'Nonce' => base64_encode($nonceBytes),
            'AccountIdentifier' => $input['accountIdentifier'],
            'AccountName' => $input['accountName'],
            'Institution' => $input['institution'],
            'ProviderID' => $input['providerId'] ?? '',
            'Memo' => $input['memo'],
            'Metadata' => $input['metadata'] ?? null,
        ];
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function encryptRecipient(array $payload, string $publicKeyPEM): string
    {
        $plaintext = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        $aesKey = random_bytes(32);
        $aesNonce = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            $aesKey,
            OPENSSL_RAW_DATA,
            $aesNonce,
            $tag,
            '',
            16,
        );
        if ($ciphertext === false) {
            throw new RuntimeException('Failed to encrypt recipient payload with AES-256-GCM');
        }

        $encryptedKey = '';
        if (!openssl_public_encrypt($aesKey, $encryptedKey, $publicKeyPEM, OPENSSL_PKCS1_PADDING)) {
            throw new RuntimeException('Failed to RSA-encrypt the AES key; check aggregator public key PEM');
        }

        $envelope = pack('N', strlen($encryptedKey)) . $encryptedKey . $aesNonce . $ciphertext . $tag;
        return base64_encode($envelope);
    }
}
