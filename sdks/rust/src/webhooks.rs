use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

pub fn verify_webhook_signature(raw_body: &str, signature: &str, secret: &str) -> bool {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key invalid");
    mac.update(raw_body.as_bytes());
    let output = mac.finalize().into_bytes();
    let expected = hex::encode(output);

    expected == signature
}
