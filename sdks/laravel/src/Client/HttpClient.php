<?php

namespace Paycrest\SDK\Client;

use RuntimeException;

class HttpClient
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly int $timeout = 20,
    ) {
    }

    public function request(string $method, string $path, ?array $body = null, array $query = []): array
    {
        $url = rtrim($this->baseUrl, '/') . $path;
        if (!empty($query)) {
            $url .= '?' . http_build_query(array_filter($query, static fn($value) => $value !== null));
        }

        $headers = [
            'Content-Type: application/json',
            'API-Key: ' . $this->apiKey,
        ];

        $context = stream_context_create([
            'http' => [
                'method' => strtoupper($method),
                'header' => implode("\r\n", $headers),
                'content' => $body ? json_encode($body, JSON_THROW_ON_ERROR) : null,
                'timeout' => $this->timeout,
                'ignore_errors' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $context);
        if ($raw === false) {
            throw new RuntimeException('Network error calling Paycrest API');
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Invalid response received from Paycrest API');
        }

        $statusLine = $http_response_header[0] ?? 'HTTP/1.1 500';
        preg_match('/\s(\d{3})\s/', $statusLine, $matches);
        $statusCode = (int)($matches[1] ?? 500);

        if ($statusCode >= 400) {
            $message = $decoded['message'] ?? 'Paycrest API request failed';
            throw new RuntimeException($message, $statusCode);
        }

        return $decoded;
    }
}
