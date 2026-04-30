"""In-memory cache for aggregator public key + token catalogue."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional


@dataclass(frozen=True)
class SupportedToken:
    symbol: str
    contract_address: str
    decimals: int
    base_currency: str
    network: str


# Process-level static token registry. Populate with `register_token`
# at startup to skip the `/v2/tokens` round-trip for hot tokens
# (e.g. USDT on base). Lookup order in AggregatorRegistry.get_token:
# static registry -> cached `/tokens` fetch -> live `/tokens` fetch.
_STATIC_TOKENS: dict[str, SupportedToken] = {}


def _key(network: str, symbol: str) -> str:
    return f"{network.lower()}::{symbol.upper()}"


def register_token(token: SupportedToken) -> None:
    """Register a token statically so the gateway path resolves it
    without hitting `/v2/tokens`."""
    _STATIC_TOKENS[_key(token.network, token.symbol)] = token


def register_tokens(tokens: Iterable[SupportedToken]) -> None:
    for t in tokens:
        register_token(t)


def list_registered_tokens() -> list[SupportedToken]:
    return list(_STATIC_TOKENS.values())


def clear_registered_tokens() -> None:
    _STATIC_TOKENS.clear()


class AggregatorRegistry:
    def __init__(self, http_client, public_key_override: Optional[str] = None):
        self._http = http_client
        self._public_key: Optional[str] = None
        self._public_key_override = public_key_override
        self._tokens_by_network: dict[str, list[SupportedToken]] = {}

    def get_public_key(self) -> str:
        if self._public_key_override:
            return self._public_key_override
        if self._public_key:
            return self._public_key
        response = self._http.call("GET", "/pubkey")
        pem = response.get("data")
        if not isinstance(pem, str) or not pem:
            raise ValueError("Aggregator /pubkey returned no PEM data")
        self._public_key = pem
        return pem

    def get_tokens_for_network(self, network: str) -> list[SupportedToken]:
        slug = network.lower()
        if slug in self._tokens_by_network:
            return self._tokens_by_network[slug]
        response = self._http.call("GET", "/tokens", query={"network": slug})
        raw = response.get("data") or []
        tokens = [
            SupportedToken(
                symbol=row["symbol"],
                contract_address=row["contractAddress"],
                decimals=int(row["decimals"]),
                base_currency=row.get("baseCurrency", ""),
                network=row.get("network", slug),
            )
            for row in raw
        ]
        self._tokens_by_network[slug] = tokens
        return tokens

    def get_token(self, network: str, symbol: str) -> SupportedToken:
        # 1) Static registry (zero-RTT for hot tokens).
        static_hit = _STATIC_TOKENS.get(_key(network, symbol))
        if static_hit is not None:
            return static_hit

        # 2) Live fetch (with in-memory cache).
        tokens = self.get_tokens_for_network(network)
        want = symbol.upper()
        for token in tokens:
            if token.symbol.upper() == want:
                return token
        known = ", ".join(t.symbol for t in tokens) or "(none)"
        raise ValueError(
            f'Token "{symbol}" is not enabled on network "{network}". Known: {known}'
        )

    def preload(self, network: str) -> list[SupportedToken]:
        """Pre-warm the in-memory cache for a network."""
        return self.get_tokens_for_network(network)
