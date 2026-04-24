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
    def test_to_subunits_and_scale_rate(self):
        from paycrest_sdk import scale_rate, to_subunits

        self.assertEqual(to_subunits("1", 6), 1_000_000)
        self.assertEqual(to_subunits("1.5", 6), 1_500_000)
        self.assertEqual(to_subunits("0.000001", 6), 1)
        with self.assertRaises(ValueError):
            to_subunits("0.0000001", 6)
        with self.assertRaises(ValueError):
            to_subunits("abc", 6)

        self.assertEqual(scale_rate("1500"), 150_000)
        self.assertEqual(scale_rate("1499.99"), 149_999)
        self.assertEqual(scale_rate("1.23"), 123)

    def test_encryption_envelope_round_trip(self):
        import base64
        import json
        import struct

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        from paycrest_sdk import build_recipient_payload, encrypt_recipient_payload

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_pem = key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        payload = build_recipient_payload(
            institution="GTBINGLA",
            account_identifier="1234567890",
            account_name="Jane Doe",
            memo="Payout",
            provider_id="AbCdEfGh",
        )
        envelope_b64 = encrypt_recipient_payload(payload, public_pem)

        envelope = base64.b64decode(envelope_b64)
        key_len = struct.unpack(">I", envelope[:4])[0]
        encrypted_key = envelope[4 : 4 + key_len]
        aes_block = envelope[4 + key_len :]
        aes_key = key.decrypt(encrypted_key, padding.PKCS1v15())
        aes_nonce = aes_block[:12]
        ciphertext_with_tag = aes_block[12:]
        plaintext = AESGCM(aes_key).decrypt(aes_nonce, ciphertext_with_tag, None)
        decoded = json.loads(plaintext)

        self.assertEqual(decoded["AccountIdentifier"], "1234567890")
        self.assertEqual(decoded["Institution"], "GTBINGLA")
        self.assertEqual(decoded["ProviderID"], "AbCdEfGh")
        self.assertIsInstance(decoded["Nonce"], str)

    def test_gateway_method_requires_configuration(self):
        from paycrest_sdk import PaycrestClient
        from paycrest_sdk.errors import PaycrestAPIError

        client = PaycrestClient(sender_api_key="sender-key")
        with self.assertRaises(PaycrestAPIError) as ctx:
            client.sender().create_offramp_order(
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
                },
                method="gateway",
            )
        self.assertIn("Gateway dispatch is not configured", str(ctx.exception))

    def test_gateway_pipeline_end_to_end(self):
        import base64
        import struct

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        from paycrest_sdk import (
            GatewayClient,
            GatewayCreateOrderArgs,
            GatewayPathConfig,
            SupportedToken,
        )
        from paycrest_sdk.registry import AggregatorRegistry

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_pem = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        calls = {"allowance_queried": False, "approve": None, "create": None}

        class StubTransactor:
            def chain_id(self_inner):
                return 8453

            def sender_address(self_inner):
                return "0xSenderEoa"

            def allowance(self_inner, token, owner, spender):
                calls["allowance_queried"] = True
                return 0

            def approve(self_inner, token, spender, amount):
                calls["approve"] = (token, spender, amount)
                return "0xApproveTxHash"

            def create_order(self_inner, gateway, args: GatewayCreateOrderArgs):
                calls["create"] = (gateway, args)
                return "0xCreateTxHash"

        registry = AggregatorRegistry(http_client=None, public_key_override=public_pem)
        registry._tokens_by_network["base"] = [
            SupportedToken(
                symbol="USDT",
                contract_address="0xTokenAddress",
                decimals=6,
                base_currency="USD",
                network="base",
            )
        ]

        gw = GatewayClient(registry, GatewayPathConfig(transactor=StubTransactor(), aggregator_public_key=public_pem))

        result = gw.create_offramp_order(
            {
                "amount": "100",
                "source": {
                    "type": "crypto",
                    "currency": "USDT",
                    "network": "base",
                    "refundAddress": "0xRefundAddress",
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
            rate_resolver=lambda *_: "1500",
        )

        self.assertTrue(calls["allowance_queried"])
        self.assertEqual(calls["approve"], ("0xTokenAddress", "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f", 100_000_000))
        gateway, args = calls["create"]
        self.assertEqual(gateway, "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f")
        self.assertEqual(args.token, "0xTokenAddress")
        self.assertEqual(args.amount, 100_000_000)
        self.assertEqual(args.rate, 150_000)
        self.assertEqual(args.refund_address, "0xRefundAddress")
        self.assertEqual(result.tx_hash, "0xCreateTxHash")
        self.assertEqual(result.approve_tx_hash, "0xApproveTxHash")

        # messageHash must be a valid envelope decryptable with the test private key.
        envelope = base64.b64decode(result.message_hash)
        key_len = struct.unpack(">I", envelope[:4])[0]
        encrypted_key = envelope[4 : 4 + key_len]
        aes_block = envelope[4 + key_len :]
        aes_key = private_key.decrypt(encrypted_key, padding.PKCS1v15())
        plaintext = AESGCM(aes_key).decrypt(aes_block[:12], aes_block[12:], None)
        import json as _json
        decoded = _json.loads(plaintext)
        self.assertEqual(decoded["AccountIdentifier"], "1234567890")
        self.assertEqual(decoded["Institution"], "GTBINGLA")


class RoughEdgesTests(unittest.TestCase):
    def test_typed_error_classification(self):
        from paycrest_sdk.errors import (
            AuthenticationError,
            NotFoundError,
            RateLimitError,
            ValidationError,
            classify_http_error,
        )

        self.assertIsInstance(classify_http_error(400, "x"), ValidationError)
        self.assertIsInstance(classify_http_error(401, "x"), AuthenticationError)
        self.assertIsInstance(classify_http_error(403, "x"), AuthenticationError)
        self.assertIsInstance(classify_http_error(404, "x"), NotFoundError)
        err = classify_http_error(429, "slow down", retry_after_seconds=2.5)
        self.assertIsInstance(err, RateLimitError)
        self.assertEqual(err.retry_after_seconds, 2.5)

    def test_rate_quote_unavailable_subtype_on_missing_side(self):
        from paycrest_sdk.errors import RateQuoteUnavailableError
        from paycrest_sdk.sender import SenderClient

        class _FakeHttp:
            def call(self, *args, **kwargs):
                # Only the rate quote is requested; returns wrong side.
                return {"status": "success", "data": {"buy": {"rate": "1"}}}

        sender = SenderClient(_FakeHttp())
        with self.assertRaises(RateQuoteUnavailableError):
            sender.create_offramp_order(
                {
                    "amount": "100",
                    "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
                    "destination": {
                        "type": "fiat",
                        "currency": "NGN",
                        "recipient": {
                            "institution": "X",
                            "accountIdentifier": "1",
                            "accountName": "Y",
                            "memo": "m",
                        },
                    },
                }
            )

    def test_wait_for_status_reaches_target(self):
        from paycrest_sdk.sender import SenderClient, WaitForStatusOptions

        class _FakeHttp:
            def __init__(self):
                self.calls = 0
                self.statuses = ["pending", "fulfilling", "settled"]

            def call(self, method, path, body=None, query=None):
                self.calls += 1
                return {"status": "success", "data": {"id": "ord", "status": self.statuses.pop(0)}}

        sender = SenderClient(_FakeHttp())
        order = sender.wait_for_status("ord", "settled", WaitForStatusOptions(poll_ms=1, timeout_ms=2_000))
        self.assertEqual(order["status"], "settled")

    def test_wait_for_status_terminal_alias_and_timeout(self):
        from paycrest_sdk.errors import PaycrestAPIError
        from paycrest_sdk.sender import SenderClient, WaitForStatusOptions

        class _Fake:
            def __init__(self, status):
                self.status = status

            def call(self, *a, **k):
                return {"status": "success", "data": {"id": "o", "status": self.status}}

        # target="terminal" matches expired
        ok = SenderClient(_Fake("expired"))
        self.assertEqual(ok.wait_for_status("o", "terminal", WaitForStatusOptions(poll_ms=1)).get("status"), "expired")

        # stuck on pending → times out
        stuck = SenderClient(_Fake("pending"))
        with self.assertRaises(PaycrestAPIError):
            stuck.wait_for_status("o", "settled", WaitForStatusOptions(poll_ms=1, timeout_ms=20))

    def test_list_orders_accepts_value_object(self):
        from paycrest_sdk.sender import ListOrdersQuery, SenderClient

        class _Fake:
            def __init__(self):
                self.last_query = None

            def call(self, method, path, body=None, query=None):
                self.last_query = query
                return {"status": "success", "data": {"orders": []}}

        http = _Fake()
        sender = SenderClient(http)
        sender.list_orders(ListOrdersQuery(page=2, page_size=50, status="settled"))
        self.assertEqual(http.last_query, {"page": 2, "pageSize": 50, "status": "settled"})

    def test_provider_list_orders_value_object(self):
        from paycrest_sdk.provider import ProviderClient, ProviderListOrdersQuery

        class _Fake:
            def __init__(self):
                self.last_query = None

            def call(self, method, path, body=None, query=None):
                self.last_query = query
                return {"status": "success", "data": {"orders": []}}

        http = _Fake()
        provider = ProviderClient(http)
        provider.list_orders(
            ProviderListOrdersQuery(currency="NGN", page=3, page_size=25, status="pending", ordering="asc")
        )
        self.assertEqual(http.last_query["currency"], "NGN")
        self.assertEqual(http.last_query["page"], 3)
        self.assertEqual(http.last_query["pageSize"], 25)
        self.assertEqual(http.last_query["ordering"], "asc")


if __name__ == "__main__":
    unittest.main()
