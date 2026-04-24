"""Off-ramp via the direct Gateway contract path (method="gateway").

The PaycrestClient accepts a GatewayTransactor — any object implementing
the ``GatewayTransactor`` protocol. This example sketches an adapter on
top of ``web3.py``; you can substitute ``eth-account`` + raw JSON-RPC or
any other wallet library your app already uses.
"""

from __future__ import annotations

import os

from paycrest_sdk import (
    GatewayCreateOrderArgs,
    GatewayPathConfig,
    PaycrestClient,
)


class Web3PyTransactor:
    """Thin web3.py adapter. Construct once per process and reuse."""

    def __init__(self, rpc_url: str, private_key: str):
        from web3 import Web3  # imported lazily — web3 is an optional dep

        self._w3 = Web3(Web3.HTTPProvider(rpc_url))
        self._acct = self._w3.eth.account.from_key(private_key)
        # Minimal ABI fragments lifted from the aggregator.
        self._erc20_abi = [
            {"type": "function", "name": "approve", "stateMutability": "nonpayable",
             "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
             "outputs": [{"name": "", "type": "bool"}]},
            {"type": "function", "name": "allowance", "stateMutability": "view",
             "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
             "outputs": [{"name": "", "type": "uint256"}]},
        ]
        self._gateway_abi = [
            {"type": "function", "name": "createOrder", "stateMutability": "nonpayable",
             "inputs": [
                 {"name": "_token", "type": "address"},
                 {"name": "_amount", "type": "uint256"},
                 {"name": "_rate", "type": "uint96"},
                 {"name": "_senderFeeRecipient", "type": "address"},
                 {"name": "_senderFee", "type": "uint256"},
                 {"name": "_refundAddress", "type": "address"},
                 {"name": "messageHash", "type": "string"},
             ],
             "outputs": [{"name": "orderId", "type": "bytes32"}]},
        ]

    def chain_id(self) -> int:
        return self._w3.eth.chain_id

    def sender_address(self) -> str:
        return self._acct.address

    def allowance(self, token: str, owner: str, spender: str) -> int:
        erc20 = self._w3.eth.contract(address=self._w3.to_checksum_address(token), abi=self._erc20_abi)
        return int(erc20.functions.allowance(owner, spender).call())

    def approve(self, token: str, spender: str, amount: int) -> str:
        erc20 = self._w3.eth.contract(address=self._w3.to_checksum_address(token), abi=self._erc20_abi)
        tx = erc20.functions.approve(spender, amount).build_transaction({
            "from": self._acct.address,
            "nonce": self._w3.eth.get_transaction_count(self._acct.address),
        })
        signed = self._w3.eth.account.sign_transaction(tx, self._acct.key)
        tx_hash = self._w3.eth.send_raw_transaction(signed.rawTransaction)
        return tx_hash.hex()

    def create_order(self, gateway: str, args: GatewayCreateOrderArgs) -> str:
        gw = self._w3.eth.contract(address=self._w3.to_checksum_address(gateway), abi=self._gateway_abi)
        tx = gw.functions.createOrder(
            args.token,
            args.amount,
            args.rate,
            args.sender_fee_recipient,
            args.sender_fee,
            args.refund_address,
            args.message_hash,
        ).build_transaction({
            "from": self._acct.address,
            "nonce": self._w3.eth.get_transaction_count(self._acct.address),
        })
        signed = self._w3.eth.account.sign_transaction(tx, self._acct.key)
        tx_hash = self._w3.eth.send_raw_transaction(signed.rawTransaction)
        return tx_hash.hex()


def main() -> None:
    transactor = Web3PyTransactor(
        rpc_url=os.environ["BASE_RPC_URL"],
        private_key=os.environ["SIGNER_PRIVATE_KEY"],
    )
    client = PaycrestClient(
        sender_api_key=os.environ.get("PAYCREST_SENDER_API_KEY"),
        gateway=GatewayPathConfig(transactor=transactor),
    )

    result = client.sender().create_offramp_order(
        {
            "amount": "100",
            "source": {
                "type": "crypto",
                "currency": "USDT",
                "network": "base",
                "refundAddress": transactor.sender_address(),
            },
            "destination": {
                "type": "fiat",
                "currency": "NGN",
                "recipient": {
                    "institution": "GTBINGLA",
                    "accountIdentifier": "1234567890",
                    "accountName": "Jane Doe",
                    "memo": "Payout",
                },
            },
        },
        method="gateway",
    )
    print(result)


if __name__ == "__main__":
    main()
