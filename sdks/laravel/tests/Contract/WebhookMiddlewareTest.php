<?php

declare(strict_types=1);

use Illuminate\Http\Request;
use Paycrest\SDK\Webhooks\VerifyPaycrestWebhook;
use Paycrest\SDK\Webhooks\WebhookEvent;
use Paycrest\SDK\Webhooks\WebhookVerifier;

const WEBHOOK_SECRET = 'test-secret';

function signWebhookBody(string $body): string
{
    return hash_hmac('sha256', $body, WEBHOOK_SECRET);
}

it('parses a signed webhook body', function (): void {
    $body = json_encode(['event' => 'order.settled', 'data' => ['id' => 'ord-1']], JSON_THROW_ON_ERROR);
    $event = WebhookVerifier::parse($body, signWebhookBody($body), WEBHOOK_SECRET);

    expect($event)->toBeInstanceOf(WebhookEvent::class);
    expect($event->event)->toBe('order.settled');
    expect($event->data['id'])->toBe('ord-1');
});

it('rejects a missing signature', function (): void {
    expect(fn () => WebhookVerifier::parse('{}', null, WEBHOOK_SECRET))
        ->toThrow(\InvalidArgumentException::class, 'missing signature');
});

it('rejects a bad signature', function (): void {
    expect(fn () => WebhookVerifier::parse('{}', 'deadbeef', WEBHOOK_SECRET))
        ->toThrow(\InvalidArgumentException::class, 'invalid signature');
});

it('rejects malformed JSON', function (): void {
    $body = '{ not json';
    expect(fn () => WebhookVerifier::parse($body, signWebhookBody($body), WEBHOOK_SECRET))
        ->toThrow(\RuntimeException::class, 'invalid JSON');
});

it('laravel middleware short-circuits on invalid signature', function (): void {
    config(['paycrest.webhook_secret' => WEBHOOK_SECRET]);
    $request = Request::create('/webhooks/paycrest', 'POST', content: '{}', server: ['HTTP_X_PAYCREST_SIGNATURE' => 'bad']);
    $called = false;
    $response = (new VerifyPaycrestWebhook())->handle($request, function () use (&$called) {
        $called = true;
    });
    expect($response->status())->toBe(401);
    expect($called)->toBeFalse();
});

it('laravel middleware attaches event to request on success', function (): void {
    config(['paycrest.webhook_secret' => WEBHOOK_SECRET]);
    $body = json_encode(['event' => 'order.pending', 'data' => ['id' => 'ord-2']], JSON_THROW_ON_ERROR);
    $request = Request::create('/webhooks/paycrest', 'POST', content: $body, server: [
        'HTTP_X_PAYCREST_SIGNATURE' => signWebhookBody($body),
    ]);
    $observed = null;
    $next = function (Request $req) use (&$observed) {
        $observed = $req->attributes->get('paycrest_event');
        return response('ok');
    };
    $response = (new VerifyPaycrestWebhook())->handle($request, $next);
    expect($response->status())->toBe(200);
    expect($observed)->toBeInstanceOf(WebhookEvent::class);
    expect($observed->event)->toBe('order.pending');
    expect($observed->data['id'])->toBe('ord-2');
});
