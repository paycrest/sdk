import hashlib
import hmac
import json
import unittest

from paycrest_sdk import parse_paycrest_webhook


SECRET = "test-secret"


def _sign(body: str) -> str:
    return hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()


class ParseWebhookTests(unittest.TestCase):
    def test_happy_path_verifies_and_parses(self) -> None:
        body = json.dumps({"event": "order.settled", "data": {"id": "ord-1", "status": "settled"}})
        event = parse_paycrest_webhook(body, _sign(body), SECRET)
        self.assertEqual(event.event, "order.settled")
        self.assertEqual(event.data["id"], "ord-1")

    def test_accepts_bytes(self) -> None:
        body = json.dumps({"data": {"id": "bytes-ok"}})
        event = parse_paycrest_webhook(body.encode("utf-8"), _sign(body), SECRET)
        self.assertEqual(event.data["id"], "bytes-ok")

    def test_missing_signature_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing signature"):
            parse_paycrest_webhook('{"data":{}}', None, SECRET)

    def test_invalid_signature_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid signature"):
            parse_paycrest_webhook('{"data":{}}', "deadbeef", SECRET)

    def test_invalid_json_raises(self) -> None:
        body = "{ not json"
        with self.assertRaisesRegex(ValueError, "invalid JSON"):
            parse_paycrest_webhook(body, _sign(body), SECRET)


if __name__ == "__main__":
    unittest.main()
