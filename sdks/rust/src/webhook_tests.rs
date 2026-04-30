use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

use crate::webhook_middleware::{parse_webhook, WebhookError};

type HmacSha256 = Hmac<Sha256>;
const SECRET: &str = "test-secret";

fn sign(body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(SECRET.as_bytes()).unwrap();
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

#[test]
fn happy_path_verifies_and_parses() {
    let body = br#"{"event":"order.settled","data":{"id":"ord-1","status":"settled"}}"#;
    let sig = sign(body);
    let event = parse_webhook(body, Some(&sig), SECRET).expect("parse");
    assert_eq!(event.event.as_deref(), Some("order.settled"));
    assert_eq!(event.data["id"], "ord-1");
}

#[test]
fn missing_signature_errors() {
    let body = b"{}";
    let err = parse_webhook(body, None, SECRET).unwrap_err();
    assert!(matches!(err, WebhookError::MissingSignature));
}

#[test]
fn invalid_signature_errors() {
    let body = b"{}";
    let err = parse_webhook(body, Some("deadbeef"), SECRET).unwrap_err();
    assert!(matches!(err, WebhookError::InvalidSignature));
}

#[test]
fn invalid_json_errors() {
    let body = b"{ not json";
    let sig = sign(body);
    let err = parse_webhook(body, Some(&sig), SECRET).unwrap_err();
    assert!(matches!(err, WebhookError::InvalidBody(_)));
}
