"""In-memory cache for aggregator public key + token catalogue."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class SupportedToken:
    symbol: str
    contract_address: str
    decimals: int
    base_currency: str
    network: str


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
        tokens = self.get_tokens_for_network(network)
        want = symbol.upper()
        for token in tokens:
            if token.symbol.upper() == want:
                return token
        known = ", ".join(t.symbol for t in tokens) or "(none)"
        raise ValueError(
            f'Token "{symbol}" is not enabled on network "{network}". Known: {known}'
        )
