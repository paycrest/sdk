//! Hybrid AES-256-GCM + RSA-2048 recipient encryption.
//!
//! Matches `utils/crypto/crypto.go::encryptHybridJSON` in the Paycrest
//! aggregator byte-for-byte.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine as _;
use rand::RngCore;
use rsa::pkcs1v15::Pkcs1v15Encrypt;
use rsa::pkcs8::DecodePublicKey;
use rsa::RsaPublicKey;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::PaycrestError;

/// Plaintext struct encrypted into the on-chain `messageHash`.
/// Field names + order must match the aggregator's struct exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct RecipientPayload {
    pub Nonce: String,
    pub AccountIdentifier: String,
    pub AccountName: String,
    pub Institution: String,
    pub ProviderID: String,
    pub Memo: String,
    pub Metadata: Option<Value>,
}

pub fn build_recipient_payload(
    institution: &str,
    account_identifier: &str,
    account_name: &str,
    memo: &str,
    provider_id: &str,
    metadata: Option<Value>,
) -> RecipientPayload {
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    RecipientPayload {
        Nonce: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
        AccountIdentifier: account_identifier.to_string(),
        AccountName: account_name.to_string(),
        Institution: institution.to_string(),
        ProviderID: provider_id.to_string(),
        Memo: memo.to_string(),
        Metadata: metadata,
    }
}

/// Produce the base64-encoded envelope the Gateway contract expects.
///
/// Envelope layout:
/// ```text
///   [4 bytes BE: encrypted-AES-key length]
///   [encrypted-AES-key bytes]
///   [12-byte AES-GCM nonce]
///   [AES-GCM ciphertext][16-byte auth tag]
/// ```
pub fn encrypt_recipient_payload(
    payload: &RecipientPayload,
    public_key_pem: &str,
) -> Result<String, PaycrestError> {
    let plaintext = serde_json::to_vec(payload)?;

    let mut aes_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut aes_key);
    let mut aes_nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut aes_nonce);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&aes_nonce), plaintext.as_ref())
        .map_err(|e| PaycrestError::Api {
            status_code: 500,
            message: format!("aes-gcm encrypt: {e}"),
            details: None,
        })?;

    let rsa_pub = RsaPublicKey::from_public_key_pem(public_key_pem).map_err(|e| {
        PaycrestError::Api {
            status_code: 500,
            message: format!("parse aggregator public key: {e}"),
            details: None,
        }
    })?;
    let mut rng = rand::thread_rng();
    let encrypted_key = rsa_pub.encrypt(&mut rng, Pkcs1v15Encrypt, &aes_key).map_err(|e| {
        PaycrestError::Api {
            status_code: 500,
            message: format!("rsa encrypt: {e}"),
            details: None,
        }
    })?;

    let key_len = encrypted_key.len() as u32;
    let mut envelope = Vec::with_capacity(4 + encrypted_key.len() + 12 + ciphertext.len());
    envelope.extend_from_slice(&key_len.to_be_bytes());
    envelope.extend_from_slice(&encrypted_key);
    envelope.extend_from_slice(&aes_nonce);
    envelope.extend_from_slice(&ciphertext);

    Ok(base64::engine::general_purpose::STANDARD.encode(envelope))
}
