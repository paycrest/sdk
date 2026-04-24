<?php

namespace Paycrest\SDK\Client;

use Paycrest\SDK\Errors\ErrorClassifier;
use Paycrest\SDK\Errors\NetworkError;
use Paycrest\SDK\Errors\PaycrestApiError;
use Paycrest\SDK\Errors\RateLimitError;

/**
 * @phpstan-type RetryPolicyArray array{retries:int,baseDelayMs:int,maxDelayMs:int}
 */
class HttpClient
{
    private const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

    /** @var RetryPolicyArray */
    private array $retryPolicy;

    /**
     * @param RetryPolicyArray|null $retryPolicy
     */
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly int $timeout = 20,
        ?array $retryPolicy = null,
    ) {
        $this->retryPolicy = $retryPolicy ?? ['retries' => 3, 'baseDelayMs' => 500, 'maxDelayMs' => 10_000];
    }

    public function request(string $method, string $path, ?array $body = null, array $query = []): array
    {
        $url = rtrim($this->baseUrl, '/') . $path;
        if (!empty($query)) {
            $url .= '?' . http_build_query(array_filter($query, static fn ($value) => $value !== null));
        }

        $policy = $this->retryPolicy;
        $methodUpper = strtoupper($method);
        $lastError = null;

        for ($attempt = 1; $attempt <= $policy['retries']; $attempt++) {
            try {
                return $this->sendOnce($methodUpper, $url, $body);
            } catch (PaycrestApiError $e) {
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
    private function sendOnce(string $method, string $url, ?array $body): array
    {
        $headers = ['Content-Type: application/json'];
        if ($this->apiKey !== '') {
            $headers[] = 'API-Key: ' . $this->apiKey;
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $body ? json_encode($body, JSON_THROW_ON_ERROR) : null,
                'timeout' => $this->timeout,
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
}
