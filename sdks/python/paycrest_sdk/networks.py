"""Canonical Paycrest network registry.

Mirrors the on-chain Gateway deployments referenced in noblocks
(``getGatewayContractAddress`` in ``app/utils.ts``). Network slugs match
the aggregator's network identifier (e.g. ``base``, ``arbitrum-one``).

Token addresses and decimals are NOT hardcoded here — they're fetched
at runtime from ``GET /v2/tokens?network=<slug>``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class NetworkInfo:
    slug: str
    chain_id: int
    display_name: str
    gateway: str


NETWORKS: dict[str, NetworkInfo] = {
    "base": NetworkInfo("base", 8453, "Base", "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f"),
    "arbitrum-one": NetworkInfo("arbitrum-one", 42161, "Arbitrum One", "0xe8bc3b607cfe68f47000e3d200310d49041148fc"),
    "bnb-smart-chain": NetworkInfo("bnb-smart-chain", 56, "BNB Smart Chain", "0x1fa0ee7f9410f6fa49b7ad5da72cf01647090028"),
    "polygon": NetworkInfo("polygon", 137, "Polygon", "0xfb411cc6385af50a562afcb441864e9d541cda67"),
    "scroll": NetworkInfo("scroll", 534352, "Scroll", "0x663c5bfe7d44ba946c2dd4b2d1cf9580319f9338"),
    "optimism": NetworkInfo("optimism", 10, "Optimism", "0xd293fcd3dbc025603911853d893a4724cf9f70a0"),
    "celo": NetworkInfo("celo", 42220, "Celo", "0xf418217e3f81092ef44b81c5c8336e6a6fdb0e4b"),
    "lisk": NetworkInfo("lisk", 1135, "Lisk", "0xff0E00E0110C1FBb5315D276243497b66D3a4d8a"),
    "ethereum": NetworkInfo("ethereum", 1, "Ethereum", "0x8d2c0d398832b814e3814802ff2dc8b8ef4381e5"),
}


def get_network(slug: str) -> NetworkInfo:
    info = NETWORKS.get(slug.lower())
    if info is None:
        raise ValueError(
            f'Unsupported network "{slug}". Known: {", ".join(NETWORKS.keys())}'
        )
    return info


def register_network(info: NetworkInfo) -> None:
    NETWORKS[info.slug.lower()] = info
