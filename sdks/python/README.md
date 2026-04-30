# paycrest-sdk

Official Paycrest SDK for Python — sender, provider, and direct on-chain off-ramp via the Paycrest Gateway contract.

## Install

```bash
pip install paycrest-sdk
```

## Quickstart

```python
from paycrest_sdk import PaycrestClient

client = PaycrestClient(sender_api_key="YOUR_KEY")

# Off-ramp via the aggregator (default).
order = client.sender().create_offramp_order({
    "amount": "100",
    "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc..."},
    "destination": {
        "type": "fiat",
        "currency": "NGN",
        "recipient": {
            "institution": "GTBINGLA",
            "accountIdentifier": "1234567890",
            "accountName": "Jane Doe",
            "memo": "Invoice 42",
        },
    },
})
print(order["providerAccount"]["receiveAddress"])

# Wait until the order reaches a terminal state.
final = client.sender().wait_for_status(order["id"], "terminal")
print(final["status"])
```

## Direct-contract off-ramp (bypass the aggregator)

```python
from paycrest_sdk import PaycrestClient, GatewayPathConfig

client = PaycrestClient(
    sender_api_key="YOUR_KEY",
    gateway=GatewayPathConfig(transactor=my_transactor),
)
result = client.sender().create_offramp_order(payload, method="gateway")
print(result.tx_hash, result.message_hash)
```

`my_transactor` is anything implementing the `GatewayTransactor` protocol
(`chain_id`, `sender_address`, `allowance`, `approve`, `create_order`).
See `sdks/python/examples/offramp_gateway.py` for a web3.py adapter.

## Webhook verification

```python
from paycrest_sdk import parse_paycrest_webhook

event = parse_paycrest_webhook(raw_body, signature_header, secret)
print(event.data["status"])
```

FastAPI and Flask helpers ship in the same package: `fastapi_paycrest_webhook`, `flask_paycrest_webhook`.

## Full docs

- Repository: <https://github.com/paycrest/sdk>
- Step-by-step walkthrough: <https://github.com/paycrest/sdk/blob/main/docs/sandbox-walkthrough.md>
- Aggregator API reference: <https://docs.paycrest.io>

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`).
