"""Direct-contract off-ramp path for Python.

Design mirrors the TypeScript + Go implementations: the SDK handles
network/token metadata resolution, RSA+AES-GCM recipient encryption,
and call orchestration (allowance check, approve, createOrder). The
actual JSON-RPC signing and broadcast is delegated to a caller-supplied
``GatewayTransactor`` protocol — typically backed by ``web3.py`` but
pluggable for any web3 library the integrator already uses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol

from .encryption import build_recipient_payload, encrypt_recipient_payload
from .networks import get_network


class GatewayTransactor(Protocol):
    """Abstract signer+RPC handle the gateway path needs.

    Implementations are expected to sign and broadcast EVM transactions
    on the caller's behalf; the SDK hands them the ABI inputs rather
    than raw calldata so adapters can use high-level helpers like
    ``web3.contract.functions.createOrder(...).transact(...)``.
    """

    def chain_id(self) -> int: ...
    def sender_address(self) -> str: ...
    def allowance(self, token: str, owner: str, spender: str) -> int: ...
    def approve(self, token: str, spender: str, amount: int) -> str: ...
    def create_order(self, gateway: str, args: "GatewayCreateOrderArgs") -> str: ...


@dataclass(frozen=True)
class GatewayCreateOrderArgs:
    token: str
    amount: int
    rate: int
    sender_fee_recipient: str
    sender_fee: int
    refund_address: str
    message_hash: str


@dataclass(frozen=True)
class GatewayOrderResult:
    tx_hash: str
    approve_tx_hash: str | None
    gateway_address: str
    token_address: str
    amount: int
    rate: str
    message_hash: str
    refund_address: str
    network: str


@dataclass
class GatewayPathConfig:
    transactor: GatewayTransactor
    aggregator_public_key: str | None = None


class GatewayClient:
    def __init__(self, registry, config: GatewayPathConfig):
        self._registry = registry
        self._config = config

    def create_offramp_order(
        self,
        payload: dict,
        rate_resolver: Callable[[str, str, str, str], str],
    ) -> GatewayOrderResult:
        network = get_network(payload["source"]["network"])

        signer_chain = self._config.transactor.chain_id()
        if signer_chain and signer_chain != network.chain_id:
            raise ValueError(
                f'Transactor chainId={signer_chain} does not match network '
                f'"{network.slug}" (chainId={network.chain_id}).'
            )

        token = self._registry.get_token(network.slug, payload["source"]["currency"])

        rate = payload.get("rate")
        if not rate:
            rate = rate_resolver(
                network.slug,
                payload["source"]["currency"],
                payload["amount"],
                payload["destination"]["currency"],
            )

        recipient_input = payload["destination"]["recipient"]
        recipient = build_recipient_payload(
            institution=recipient_input["institution"],
            account_identifier=recipient_input["accountIdentifier"],
            account_name=recipient_input["accountName"],
            memo=recipient_input["memo"],
            provider_id=payload["destination"].get("providerId", ""),
        )
        public_key = self._registry.get_public_key()
        message_hash = encrypt_recipient_payload(recipient, public_key)

        amount_sub = to_subunits(payload["amount"], token.decimals)
        fee_sub = to_subunits(payload["senderFee"], token.decimals) if payload.get("senderFee") else 0
        rate_scaled = scale_rate(rate)

        refund_address = payload["source"].get("refundAddress") or self._config.transactor.sender_address()
        sender_fee_recipient = (
            payload.get("senderFeeRecipient") or "0x0000000000000000000000000000000000000000"
        )

        approve_hash = None
        needed = amount_sub + fee_sub
        if needed > 0:
            current = self._config.transactor.allowance(
                token.contract_address, self._config.transactor.sender_address(), network.gateway,
            )
            if current < needed:
                approve_hash = self._config.transactor.approve(
                    token.contract_address, network.gateway, needed,
                )

        tx_hash = self._config.transactor.create_order(
            network.gateway,
            GatewayCreateOrderArgs(
                token=token.contract_address,
                amount=amount_sub,
                rate=rate_scaled,
                sender_fee_recipient=sender_fee_recipient,
                sender_fee=fee_sub,
                refund_address=refund_address,
                message_hash=message_hash,
            ),
        )

        return GatewayOrderResult(
            tx_hash=tx_hash,
            approve_tx_hash=approve_hash,
            gateway_address=network.gateway,
            token_address=token.contract_address,
            amount=amount_sub,
            rate=rate,
            message_hash=message_hash,
            refund_address=refund_address,
            network=network.slug,
        )


def to_subunits(amount: str, decimals: int) -> int:
    """Convert a positive decimal string to integer base units."""
    import re

    trimmed = amount.strip()
    if not re.fullmatch(r"\d+(\.\d+)?", trimmed):
        raise ValueError(f'Invalid amount "{amount}"; expected positive decimal')
    parts = trimmed.split(".", 1)
    whole = parts[0]
    fraction = parts[1] if len(parts) == 2 else ""
    if len(fraction) > decimals:
        raise ValueError(
            f'Amount "{amount}" has more fractional digits than token decimals ({decimals})'
        )
    fraction = fraction.ljust(decimals, "0")
    return int(whole + fraction)


def scale_rate(rate: str) -> int:
    """Scale a decimal-string rate to the uint96 the Gateway expects."""
    import re

    trimmed = rate.strip()
    if not re.fullmatch(r"\d+(\.\d+)?", trimmed):
        raise ValueError(f'Invalid rate "{rate}"')
    parts = trimmed.split(".", 1)
    whole = parts[0]
    fraction = parts[1] if len(parts) == 2 else ""
    if len(fraction) <= 2:
        fraction = fraction.ljust(2, "0")
        return int(whole + fraction)
    value = int(whole + fraction[:2])
    if int(fraction[2]) >= 5:
        value += 1
    return value
