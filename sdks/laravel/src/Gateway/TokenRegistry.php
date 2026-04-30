<?php

declare(strict_types=1);

namespace Paycrest\SDK\Gateway;

/**
 * Process-level static token registry. Pre-seed with `register()` at
 * startup to skip the `/v2/tokens` round-trip for hot tokens.
 *
 * Lookup order in the gateway path: static registry -> in-memory
 * `/tokens` cache -> live `/tokens` fetch. First hit wins.
 */
final class TokenRegistry
{
    /** @var array<string, array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}> */
    private static array $tokens = [];

    private static function key(string $network, string $symbol): string
    {
        return strtolower($network) . '::' . strtoupper($symbol);
    }

    /**
     * @param array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string} $token
     */
    public static function register(array $token): void
    {
        self::$tokens[self::key($token['network'], $token['symbol'])] = $token;
    }

    /**
     * @param iterable<int, array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}> $tokens
     */
    public static function registerMany(iterable $tokens): void
    {
        foreach ($tokens as $t) {
            self::register($t);
        }
    }

    /**
     * @return array<int, array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}>
     */
    public static function all(): array
    {
        return array_values(self::$tokens);
    }

    public static function clear(): void
    {
        self::$tokens = [];
    }

    /**
     * @return array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}|null
     */
    public static function lookup(string $network, string $symbol): ?array
    {
        return self::$tokens[self::key($network, $symbol)] ?? null;
    }
}
