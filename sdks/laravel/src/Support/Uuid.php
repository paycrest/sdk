<?php

declare(strict_types=1);

namespace Paycrest\SDK\Support;

/**
 * Tiny UUIDv4 generator. Lives here (instead of `Client\HttpClient`)
 * so other parts of the SDK that need a UUID — `SenderClient::ensureReference`,
 * for example — don't reach back into the HTTP layer for it.
 *
 * We avoid pulling in ramsey/uuid to keep the install surface minimal.
 */
final class Uuid
{
    public static function v4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
            . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
    }
}
