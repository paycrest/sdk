import hashlib
import hmac
import unittest

from paycrest_sdk.webhooks import verify_webhook_signature


class WebhookTest(unittest.TestCase):
    def test_verify_signature(self):
        body = '{"id":"abc","status":"settled"}'
        secret = "my-secret"
        signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()

        self.assertTrue(verify_webhook_signature(body, signature, secret))
        self.assertFalse(verify_webhook_signature(body, "bad", secret))


if __name__ == "__main__":
    unittest.main()
