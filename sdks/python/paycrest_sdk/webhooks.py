import hashlib
import hmac


def verify_webhook_signature(raw_body: str, signature: str, secret: str) -> bool:
    digest = hmac.new(secret.encode("utf-8"), raw_body.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)
