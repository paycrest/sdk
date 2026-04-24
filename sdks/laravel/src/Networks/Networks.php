<?php

declare(strict_types=1);

namespace Paycrest\SDK\Networks;

use InvalidArgumentException;

/**
 * Canonical Paycrest network registry.
 *
 * Mirrors the on-chain Gateway deployments referenced in noblocks.
 * Network slugs match the aggregator's `network.identifier` (e.g.
 * `base`, `arbitrum-one`).
 */
final class Networks
{
    /** @var array<string, array{slug:string,chainId:int,displayName:string,gateway:string}> */
    private static array $networks = [
        'base' => ['slug' => 'base', 'chainId' => 8453, 'displayName' => 'Base', 'gateway' => '0x30f6a8457f8e42371e204a9c103f2bd42341dd0f'],
        'arbitrum-one' => ['slug' => 'arbitrum-one', 'chainId' => 42161, 'displayName' => 'Arbitrum One', 'gateway' => '0xe8bc3b607cfe68f47000e3d200310d49041148fc'],
        'bnb-smart-chain' => ['slug' => 'bnb-smart-chain', 'chainId' => 56, 'displayName' => 'BNB Smart Chain', 'gateway' => '0x1fa0ee7f9410f6fa49b7ad5da72cf01647090028'],
        'polygon' => ['slug' => 'polygon', 'chainId' => 137, 'displayName' => 'Polygon', 'gateway' => '0xfb411cc6385af50a562afcb441864e9d541cda67'],
        'scroll' => ['slug' => 'scroll', 'chainId' => 534352, 'displayName' => 'Scroll', 'gateway' => '0x663c5bfe7d44ba946c2dd4b2d1cf9580319f9338'],
        'optimism' => ['slug' => 'optimism', 'chainId' => 10, 'displayName' => 'Optimism', 'gateway' => '0xd293fcd3dbc025603911853d893a4724cf9f70a0'],
        'celo' => ['slug' => 'celo', 'chainId' => 42220, 'displayName' => 'Celo', 'gateway' => '0xf418217e3f81092ef44b81c5c8336e6a6fdb0e4b'],
        'lisk' => ['slug' => 'lisk', 'chainId' => 1135, 'displayName' => 'Lisk', 'gateway' => '0xff0E00E0110C1FBb5315D276243497b66D3a4d8a'],
        'ethereum' => ['slug' => 'ethereum', 'chainId' => 1, 'displayName' => 'Ethereum', 'gateway' => '0x8d2c0d398832b814e3814802ff2dc8b8ef4381e5'],
    ];

    /**
     * @return array{slug:string,chainId:int,displayName:string,gateway:string}
     */
    public static function get(string $slug): array
    {
        $key = strtolower($slug);
        if (!isset(self::$networks[$key])) {
            $known = implode(', ', array_keys(self::$networks));
            throw new InvalidArgumentException("Unsupported network \"{$slug}\". Known: {$known}");
        }
        return self::$networks[$key];
    }

    /**
     * @param array{slug:string,chainId:int,displayName:string,gateway:string} $info
     */
    public static function register(array $info): void
    {
        self::$networks[strtolower($info['slug'])] = $info;
    }
}
