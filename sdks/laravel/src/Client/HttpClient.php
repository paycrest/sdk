<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Errors\ErrorClassifier;
use Paycrest\SDK\Errors\NetworkError;
use Paycrest\SDK\Errors\PaycrestApiError;
use Paycrest\SDK\Errors\RateLimitError;

/**
 * Per-request observation context handed to each hook.
 */
final class HookContext
{
    public function __construct(
        public readonly string $method,
        public readonly string $url,
        public readonly int $attempt,
        public readonly ?string $idempotencyKey = null,
        public ?int $statusCode = null,
        public ?float $durationMs = null,
        public ?\Throwable $error = null,
    ) {
    }
}

/**
 * Optional callback bag attached to {@see HttpClient}. Each hook is
 * invoked at the appropriate point in the retry loop. Exceptions
 * thrown from hooks are caught and discarded so a faulty tracer can
 * never break the SDK's own error semantics.
 */
final class RequestHooks
{
    /**
     * @param (callable(HookContext):void)|null $onRequest
     * @param (callable(HookContext):void)|null $onResponse
     * @param (callable(HookContext):void)|null $onError
     */
    public function __construct(
        public readonly mixed $onRequest = null,
        public readonly mixed $onResponse = null,
        public readonly mixed $onError = null,
    ) {
    }

    public function fire(?callable $cb, HookContext $ctx): void
    {
        if ($cb === null) {
            return;
        }
        try {
            $cb($ctx);
        } catch (\Throwable) {
            // hooks are passive; swallow.
        }
    }
}

/**
 * @phpstan-type RetryPolicyArray array{retries:int,baseDelayMs:int,maxDelayMs:int}
 */
class HttpClient
{
    private const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

    /** @var RetryPolicyArray */
    private array $retryPolicy;

    private RequestHooks $hooks;

    /**
     * @param RetryPolicyArray|null $retryPolicy
     */
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly int $timeout = 20,
        ?array $retryPolicy = null,
        ?RequestHooks $hooks = null,
    ) {
        $this->retryPolicy = $retryPolicy ?? ['retries' => 3, 'baseDelayMs' => 500, 'maxDelayMs' => 10_000];
        $this->hooks = $hooks ?? new RequestHooks();
    }

    public function request(string $method, string $path, ?array $body = null, array $query = [], ?string $idempotencyKey = null, ?int $timeoutSeconds = null): array
    {
        $url = rtrim($this->baseUrl, '/') . $path;
        if (!empty($query)) {
            $url .= '?' . http_build_query(array_filter($query, static fn ($value) => $value !== null));
        }

        $policy = $this->retryPolicy;
        $methodUpper = strtoupper($method);
        $lastError = null;

        // Auto-generate a UUIDv4 Idempotency-Key on POSTs so all retries
        // of the same logical request share one identifier.
        $effectiveKey = $idempotencyKey;
        if ($effectiveKey === null && $methodUpper === 'POST') {
            $effectiveKey = self::uuidV4();
        }

        $effectiveTimeout = $timeoutSeconds ?? $this->timeout;

        for ($attempt = 1; $attempt <= $policy['retries']; $attempt++) {
            $ctx = new HookContext(method: $methodUpper, url: $url, attempt: $attempt, idempotencyKey: $effectiveKey);
            $this->hooks->fire($this->hooks->onRequest, $ctx);
            $startedAt = microtime(true);
            try {
                $response = $this->sendOnce($methodUpper, $url, $body, $effectiveKey, $effectiveTimeout);
                $ctx->durationMs = (microtime(true) - $startedAt) * 1000;
                $ctx->statusCode = 200;
                $this->hooks->fire($this->hooks->onResponse, $ctx);
                return $response;
            } catch (PaycrestApiError $e) {
                $ctx->durationMs = (microtime(true) - $startedAt) * 1000;
                $ctx->statusCode = $e->statusCode ?: null;
                $ctx->error = $e;
                $this->hooks->fire($this->hooks->onError, $ctx);
                $lastError = $e;
                if ($attempt >= $policy['retries']) {
                    break;
                }
                if (!$this->isRetryable($e, $methodUpper)) {
                    break;
                }
                usleep($this->computeBackoff($attempt, $e, $policy) * 1000);
            }
        }
        throw $lastError ?? new NetworkError('Unknown HTTP failure');
    }

    /**
     * @param array<int|string,mixed>|null $body
     * @return array<string,mixed>
     */
    private function sendOnce(string $method, string $url, ?array $body, ?string $idempotencyKey = null, ?int $timeoutSeconds = null): array
    {
        $headers = ['Content-Type: application/json'];
        if ($this->apiKey !== '') {
            $headers[] = 'API-Key: ' . $this->apiKey;
        }
        if ($idempotencyKey !== null && $idempotencyKey !== '') {
            $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $body ? json_encode($body, JSON_THROW_ON_ERROR) : null,
                'timeout' => $timeoutSeconds ?? $this->timeout,
                'ignore_errors' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $context);
        if ($raw === false) {
            throw new NetworkError('Network error calling Paycrest API');
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new PaycrestApiError('Invalid response received from Paycrest API', 500);
        }

        // $http_response_header is set by file_get_contents on HTTP streams.
        /** @var array<int,string> $http_response_header */
        $statusLine = $http_response_header[0] ?? 'HTTP/1.1 500';
        preg_match('/\s(\d{3})\s/', $statusLine, $matches);
        $statusCode = (int)($matches[1] ?? 500);

        $retryAfter = null;
        foreach ($http_response_header as $line) {
            if (stripos($line, 'retry-after:') === 0) {
                $val = trim(substr($line, strlen('retry-after:')));
                if (is_numeric($val)) {
                    $retryAfter = (float)$val;
                }
                break;
            }
        }

        if ($statusCode >= 400) {
            $message = $decoded['message'] ?? 'Paycrest API request failed';
            throw ErrorClassifier::classifyHttpError(
                $statusCode,
                is_string($message) ? $message : 'Paycrest API request failed',
                $decoded['data'] ?? null,
                $retryAfter,
            );
        }

        return $decoded;
    }

    private function isRetryable(PaycrestApiError $e, string $method): bool
    {
        if ($e instanceof NetworkError) {
            return true;
        }
        if ($method !== 'GET') {
            return false;
        }
        return in_array($e->statusCode, self::RETRYABLE_STATUS_CODES, true);
    }

    /**
     * @param RetryPolicyArray $policy
     */
    private function computeBackoff(int $attempt, PaycrestApiError $e, array $policy): int
    {
        if ($e instanceof RateLimitError && $e->retryAfterSeconds !== null && $e->retryAfterSeconds > 0) {
            return min((int)($e->retryAfterSeconds * 1000), $policy['maxDelayMs']);
        }
        $exponent = $policy['baseDelayMs'] * (2 ** ($attempt - 1));
        $jittered = random_int(0, $exponent);
        return min($jittered, $policy['maxDelayMs']);
    }

    /**
     * Small UUIDv4 generator — we avoid pulling in ramsey/uuid to keep
     * the install surface minimal.
     */
    public static function uuidV4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
            . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
    }
}
