import unittest

from paycrest_sdk.client import PaycrestClient
from paycrest_sdk.errors import PaycrestAPIError
from paycrest_sdk.provider import ProviderClient
from paycrest_sdk.sender import SenderClient


class MockHTTP:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def call(self, method: str, path: str, body=None, query=None):
        self.calls.append({"method": method, "path": path, "body": body, "query": query})
        if not self.responses:
            raise AssertionError("unexpected call")
        next_response = self.responses.pop(0)
        if isinstance(next_response, Exception):
            raise next_response
        if callable(next_response):
            return next_response(self.calls[-1])
        return next_response


class SenderContractTests(unittest.TestCase):
    def test_offramp_auto_rate_uses_sell(self):
        http = MockHTTP([
            {"status": "success", "data": {"sell": {"rate": "1500"}}},
            lambda call: {"status": "success", "data": {"id": "ord-1", "rate": call["body"]["rate"]}},
        ])
        sender = SenderClient(http)

        order = sender.create_offramp_order(
            {
                "amount": "100",
                "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
                "destination": {
                    "type": "fiat",
                    "currency": "NGN",
                    "recipient": {
                        "institution": "GTBINGLA",
                        "accountIdentifier": "1234567890",
                        "accountName": "Jane",
                        "memo": "Payout",
                    },
                },
            }
        )

        self.assertEqual(order["rate"], "1500")
        self.assertEqual(http.calls[0]["path"], "/rates/base/USDT/100/NGN")
        self.assertEqual(http.calls[0]["query"]["side"], "sell")

    def test_onramp_auto_rate_uses_buy(self):
        http = MockHTTP([
            {"status": "success", "data": {"buy": {"rate": "1480"}}},
            lambda call: {"status": "success", "data": {"id": "ord-2", "rate": call["body"]["rate"]}},
        ])
        sender = SenderClient(http)

        order = sender.create_onramp_order(
            {
                "amount": "50000",
                "source": {
                    "type": "fiat",
                    "currency": "NGN",
                    "refundAccount": {
                        "institution": "GTBINGLA",
                        "accountIdentifier": "1234567890",
                        "accountName": "Jane",
                    },
                },
                "destination": {
                    "type": "crypto",
                    "currency": "USDT",
                    "recipient": {"address": "0xabc", "network": "base"},
                },
            }
        )

        self.assertEqual(order["rate"], "1480")
        self.assertEqual(http.calls[0]["query"]["side"], "buy")

    def test_manual_rate_skips_quote_fetch(self):
        http = MockHTTP([
            lambda call: {"status": "success", "data": {"id": "ord-3", "rate": call["body"]["rate"]}},
        ])
        sender = SenderClient(http)

        sender.create_offramp_order(
            {
                "amount": "100",
                "rate": "1499",
                "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
                "destination": {
                    "type": "fiat",
                    "currency": "NGN",
                    "recipient": {
                        "institution": "GTBINGLA",
                        "accountIdentifier": "1234567890",
                        "accountName": "Jane",
                        "memo": "Payout",
                    },
                },
            }
        )

        self.assertEqual(len(http.calls), 1)
        self.assertEqual(http.calls[0]["path"], "/sender/orders")

    def test_create_order_routes_by_direction(self):
        http = MockHTTP([
            {"status": "success", "data": {"sell": {"rate": "1500"}}},
            {"status": "success", "data": {"id": "offramp"}},
            {"status": "success", "data": {"buy": {"rate": "1480"}}},
            {"status": "success", "data": {"id": "onramp"}},
        ])
        sender = SenderClient(http)

        sender.create_order(
            {
                "amount": "100",
                "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
                "destination": {
                    "type": "fiat",
                    "currency": "NGN",
                    "recipient": {
                        "institution": "GTBINGLA",
                        "accountIdentifier": "1234567890",
                        "accountName": "Jane",
                        "memo": "Payout",
                    },
                },
            }
        )

        sender.create_order(
            {
                "amount": "50000",
                "source": {
                    "type": "fiat",
                    "currency": "NGN",
                    "refundAccount": {
                        "institution": "GTBINGLA",
                        "accountIdentifier": "1234567890",
                        "accountName": "Jane",
                    },
                },
                "destination": {
                    "type": "crypto",
                    "currency": "USDT",
                    "recipient": {"address": "0xabc", "network": "base"},
                },
            }
        )

        self.assertEqual(http.calls[0]["query"]["side"], "sell")
        self.assertEqual(http.calls[2]["query"]["side"], "buy")

    def test_rate_missing_side_quote_raises(self):
        http = MockHTTP([
            {"status": "success", "data": {"buy": {"rate": "1480"}}},
        ])
        sender = SenderClient(http)

        with self.assertRaises(PaycrestAPIError):
            sender.create_offramp_order(
                {
                    "amount": "100",
                    "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
                    "destination": {
                        "type": "fiat",
                        "currency": "NGN",
                        "recipient": {
                            "institution": "GTBINGLA",
                            "accountIdentifier": "1234567890",
                            "accountName": "Jane",
                            "memo": "Payout",
                        },
                    },
                }
            )


class ProviderContractTests(unittest.TestCase):
    def test_provider_endpoints(self):
        http = MockHTTP(
            [
                {"status": "success", "data": {"total": 0, "orders": []}},
                {"status": "success", "data": {"id": "ord-1"}},
                {"status": "success", "data": {"totalOrders": 1}},
                {"status": "success", "data": {"node": "n1"}},
                {"status": "success", "data": {"buy": {"marketRate": "1"}}},
            ]
        )
        provider = ProviderClient(http)

        provider.list_orders("NGN", page=2, page_size=5, status="pending", ordering="desc")
        provider.get_order("ord-1")
        provider.get_stats("NGN")
        provider.get_node_info()
        provider.get_market_rate("USDT", "NGN")

        self.assertEqual(http.calls[0]["path"], "/provider/orders")
        self.assertEqual(http.calls[0]["query"]["currency"], "NGN")
        self.assertEqual(http.calls[1]["path"], "/provider/orders/ord-1")
        self.assertEqual(http.calls[2]["path"], "/provider/stats")
        self.assertEqual(http.calls[3]["path"], "/provider/node-info")
        self.assertEqual(http.calls[4]["path"], "/provider/rates/USDT/NGN")


class ClientCredentialTests(unittest.TestCase):
    def test_sender_requires_credentials(self):
        client = PaycrestClient()
        with self.assertRaises(ValueError):
            client.sender()

    def test_provider_requires_credentials(self):
        client = PaycrestClient()
        with self.assertRaises(ValueError):
            client.provider()


class GatewayContractTests(unittest.TestCase):
    def test_build_create_order_call_shape(self):
        from paycrest_sdk.gateway import (
            GATEWAY_ABI,
            Gateway,
            GatewayCreateOrderParams,
        )

        gateway = Gateway("0x1111111111111111111111111111111111111111", network="base")
        call = gateway.build_create_order_call(
            GatewayCreateOrderParams(
                token="0x2222222222222222222222222222222222222222",
                amount=1000000,
                rate=1500,
                sender_fee_recipient="0x3333333333333333333333333333333333333333",
                sender_fee=0,
                refund_address="0x4444444444444444444444444444444444444444",
                message_hash="QmMessageCid",
            )
        )

        self.assertEqual(call.to, "0x1111111111111111111111111111111111111111")
        self.assertEqual(call.function_name, "createOrder")
        self.assertEqual(call.value, "0")
        self.assertEqual(call.abi, GATEWAY_ABI)
        self.assertEqual(
            call.args,
            (
                "0x2222222222222222222222222222222222222222",
                1000000,
                1500,
                "0x3333333333333333333333333333333333333333",
                0,
                "0x4444444444444444444444444444444444444444",
                "QmMessageCid",
            ),
        )

    def test_registry_lookup(self):
        from paycrest_sdk.gateway import GATEWAY_ADDRESSES, Gateway

        with self.assertRaises(ValueError):
            Gateway.for_network("unknown-net")

        Gateway.register("test-net", "0xABCDEF0000000000000000000000000000000000")
        gateway = Gateway.for_network("test-net")
        self.assertEqual(
            gateway.address, "0xABCDEF0000000000000000000000000000000000"
        )
        self.assertEqual(
            GATEWAY_ADDRESSES["test-net"],
            "0xABCDEF0000000000000000000000000000000000",
        )

    def test_get_order_info_call(self):
        from paycrest_sdk.gateway import Gateway

        gateway = Gateway("0x1111111111111111111111111111111111111111")
        call = gateway.build_get_order_info_call(
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        )
        self.assertEqual(call.function_name, "getOrderInfo")
        self.assertEqual(
            call.args,
            (
                "0x0000000000000000000000000000000000000000000000000000000000000001",
            ),
        )

    def test_constructor_requires_address(self):
        from paycrest_sdk.gateway import Gateway

        with self.assertRaises(ValueError):
            Gateway("")


if __name__ == "__main__":
    unittest.main()
