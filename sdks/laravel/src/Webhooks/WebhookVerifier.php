<?php

declare(strict_types=1);

namespace Paycrest\SDK\Webhooks;

use InvalidArgumentException;
use Paycrest\SDK\Client\PaycrestClient;
use RuntimeException;

/**
 * Framework-agnostic parse + verify helper.
 *
 * Usage from any controller:
 *
 *   $event = WebhookVerifier::parse(
 *       $request->getContent(),
 *       $request->header('X-Paycrest-Signature'),
 *       config('paycrest.webhook_secret'),
 *   );
 */
final class WebhookVerifier
{
    public static function parse(string $rawBody, ?string $signature, string $secret): WebhookEvent
    {
        if ($signature === null || $signature === '') {
            throw new InvalidArgumentException('paycrest webhook: missing signature');
        }
        if (!PaycrestClient::verifyWebhookSignature($rawBody, $signature, $secret)) {
            throw new InvalidArgumentException('paycrest webhook: invalid signature');
        }
        $decoded = json_decode($rawBody, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('paycrest webhook: invalid JSON body');
        }
        return new WebhookEvent(
            event: isset($decoded['event']) ? (string)$decoded['event'] : null,
            timestamp: isset($decoded['timestamp']) ? (string)$decoded['timestamp'] : null,
            data: isset($decoded['data']) && is_array($decoded['data']) ? $decoded['data'] : null,
        );
    }
}
