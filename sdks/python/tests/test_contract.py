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


if __name__ == "__main__":
    unittest.main()
