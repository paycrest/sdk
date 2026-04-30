<?php

declare(strict_types=1);

namespace Paycrest\SDK\Webhooks;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use RuntimeException;

/**
 * Laravel middleware that verifies an incoming Paycrest webhook, attaches
 * the parsed event to the request, and short-circuits with 401/400
 * responses on failure.
 *
 * Register as a route middleware in a service provider or directly on a
 * route group::
 *
 *   Route::post('/webhooks/paycrest', HandlerController::class)
 *       ->middleware(VerifyPaycrestWebhook::class);
 *
 * In the handler, access the event via ``$request->attributes->get('paycrest_event')``.
 */
final class VerifyPaycrestWebhook
{
    public function __construct()
    {
    }

    public function handle(Request $request, Closure $next, ?string $secret = null): mixed
    {
        $resolvedSecret = $secret ?? (string) config('paycrest.webhook_secret', '');
        if ($resolvedSecret === '') {
            throw new RuntimeException('VerifyPaycrestWebhook: no webhook secret configured (paycrest.webhook_secret).');
        }

        $signature = $request->header('X-Paycrest-Signature');
        try {
            $event = WebhookVerifier::parse($request->getContent(), $signature, $resolvedSecret);
        } catch (InvalidArgumentException $e) {
            return new JsonResponse(['error' => $e->getMessage()], 401);
        } catch (RuntimeException $e) {
            return new JsonResponse(['error' => $e->getMessage()], 400);
        }

        $request->attributes->set('paycrest_event', $event);
        return $next($request);
    }
}
