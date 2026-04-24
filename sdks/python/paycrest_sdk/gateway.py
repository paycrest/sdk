"""Direct-contract off-ramp helpers.

Integrators who want to bypass the aggregator API can call the Paycrest
Gateway contract directly (the pattern used by noblocks). This module is
web3-library-agnostic: it returns the contract address, ABI, function
name and argument tuple so callers can hand them to web3.py / eth-abi /
eth-account or any other signer they already use.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

GATEWAY_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "createOrder",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_token", "type": "address"},
            {"name": "_amount", "type": "uint256"},
            {"name": "_rate", "type": "uint96"},
            {"name": "_senderFeeRecipient", "type": "address"},
            {"name": "_senderFee", "type": "uint256"},
            {"name": "_refundAddress", "type": "address"},
            {"name": "messageHash", "type": "string"},
        ],
        "outputs": [{"name": "orderId", "type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "getOrderInfo",
        "stateMutability": "view",
        "inputs": [{"name": "_orderId", "type": "bytes32"}],
        "outputs": [
            {
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "sender", "type": "address"},
                    {"name": "token", "type": "address"},
                    {"name": "senderFeeRecipient", "type": "address"},
                    {"name": "senderFee", "type": "uint256"},
                    {"name": "protocolFee", "type": "uint256"},
                    {"name": "isFulfilled", "type": "bool"},
                    {"name": "isRefunded", "type": "bool"},
                    {"name": "refundAddress", "type": "address"},
                    {"name": "currentBPS", "type": "uint96"},
                    {"name": "amount", "type": "uint256"},
                ],
            }
        ],
    },
    {
        "type": "event",
        "name": "OrderCreated",
        "inputs": [
            {"indexed": True, "name": "sender", "type": "address"},
            {"indexed": True, "name": "token", "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
            {"indexed": False, "name": "protocolFee", "type": "uint256"},
            {"indexed": True, "name": "orderId", "type": "bytes32"},
            {"indexed": False, "name": "rate", "type": "uint96"},
            {"indexed": False, "name": "messageHash", "type": "string"},
        ],
    },
]


GATEWAY_ADDRESSES: dict[str, str] = {}


@dataclass(frozen=True)
class GatewayCreateOrderParams:
    token: str
    amount: int
    rate: int
    sender_fee_recipient: str
    sender_fee: int
    refund_address: str
    message_hash: str


@dataclass(frozen=True)
class GatewayTxRequest:
    to: str
    abi: list[dict[str, Any]]
    function_name: str
    args: tuple[Any, ...]
    value: str = "0"


class Gateway:
    def __init__(self, address: str, network: str | None = None) -> None:
        if not address:
            raise ValueError("Gateway contract address is required")
        self.address = address
        self.network = network

    @classmethod
    def for_network(cls, network: str, address: str | None = None) -> "Gateway":
        resolved = address or GATEWAY_ADDRESSES.get(network)
        if not resolved:
            raise ValueError(
                f'No Gateway address registered for network "{network}". '
                "Pass an address explicitly or call Gateway.register()."
            )
        return cls(resolved, network)

    @staticmethod
    def register(network: str, address: str) -> None:
        GATEWAY_ADDRESSES[network] = address

    def build_create_order_call(
        self, params: GatewayCreateOrderParams
    ) -> GatewayTxRequest:
        return GatewayTxRequest(
            to=self.address,
            abi=GATEWAY_ABI,
            function_name="createOrder",
            args=(
                params.token,
                int(params.amount),
                int(params.rate),
                params.sender_fee_recipient,
                int(params.sender_fee),
                params.refund_address,
                params.message_hash,
            ),
        )

    def build_get_order_info_call(self, order_id: str) -> GatewayTxRequest:
        return GatewayTxRequest(
            to=self.address,
            abi=GATEWAY_ABI,
            function_name="getOrderInfo",
            args=(order_id,),
        )
