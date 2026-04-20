<?php

declare(strict_types=1);

namespace Paycrest\SDK\Tests\Support;

use Paycrest\SDK\Client\HttpClient;
use ReflectionFunction;
use RuntimeException;

final class MockHttpClient extends HttpClient
{
    /** @var array<int, array{method:string,path:string,body:?array,query:array}> */
    private array $calls = [];

    /** @var array<int, callable|array> */
    private array $responses;

    /**
     * @param array<int, callable|array> $responses
     */
    public function __construct(array $responses)
    {
        $this->responses = $responses;
    }

    /**
     * @return array<int, array{method:string,path:string,body:?array,query:array}>
     */
    public function calls(): array
    {
        return $this->calls;
    }

    public function client(): HttpClient
    {
        return $this;
    }

    public function asHttpClient(): HttpClient
    {
        return $this;
    }

    public function request(string $method, string $path, ?array $body = null, array $query = []): array
    {
        $filteredQuery = array_filter($query, static fn ($value): bool => $value !== null);
        $call = [
            'method' => strtoupper($method),
            'path' => $path,
            'body' => $body,
            'query' => $filteredQuery,
        ];
        $this->calls[] = $call;

        if ($this->responses === []) {
            throw new RuntimeException("Unexpected request: {$call['method']} {$call['path']}");
        }

        $next = array_shift($this->responses);
        if (is_callable($next)) {
            $arity = (new ReflectionFunction(\Closure::fromCallable($next)))->getNumberOfParameters();
            $response = $arity > 0 ? $next($call) : $next();
        } else {
            $response = $next;
        }

        if (!is_array($response)) {
            throw new RuntimeException('Mock response must be an array.');
        }

        return $response;
    }
}
