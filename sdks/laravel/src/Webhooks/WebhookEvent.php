<?php

declare(strict_types=1);

namespace Paycrest\SDK\Webhooks;

/**
 * Parsed + verified webhook envelope. The ``data`` field is kept as
 * an associative array so callers can hydrate it into whatever domain
 * model makes sense for them.
 */
final class WebhookEvent
{
    /**
     * @param array<string, mixed>|null $data
     */
    public function __construct(
        public readonly ?string $event,
        public readonly ?string $timestamp,
        public readonly ?array $data,
    ) {
    }
}
