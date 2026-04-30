use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Verify a Paycrest webhook signature in constant time.
///
/// Uses `Mac::verify_slice` so the comparison runs in constant time
/// w.r.t. the secret bytes — matching the timing-safe behaviour of the
/// other SDKs (`crypto.timingSafeEqual`, `hmac.compare_digest`,
/// `hmac.Equal`, `hash_equals`).
pub fn verify_webhook_signature(raw_body: &str, signature: &str, secret: &str) -> bool {
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(raw_body.as_bytes());
    let Ok(expected_bytes) = hex::decode(signature) else {
        return false;
    };
    mac.verify_slice(&expected_bytes).is_ok()
}
