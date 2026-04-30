//! Framework-agnostic webhook verification helper.
//!
//! Rust's HTTP ecosystem is too fragmented to ship per-framework
//! middleware here (axum / actix / rocket / warp all disagree), so we
//! offer a thin parse-and-verify helper that plays nicely with each:
//!
//! ```ignore
//! // axum example
//! async fn webhook(headers: HeaderMap, body: Bytes) -> Result<(), StatusCode> {
//!     let sig = headers.get("X-Paycrest-Signature")
//!         .and_then(|v| v.to_str().ok());
//!     let event = paycrest_sdk::parse_webhook(&body, sig, &std::env::var("SECRET").unwrap())
//!         .map_err(|_| StatusCode::UNAUTHORIZED)?;
//!     // handle event.data ...
//!     Ok(())
//! }
//! ```

use serde::Deserialize;

use crate::webhooks::verify_webhook_signature;

/// Parsed + verified webhook envelope. `data` is kept as `serde_json::Value`
/// so callers can deserialize into whatever shape they care about.
#[derive(Debug, Clone, Deserialize)]
pub struct WebhookEvent {
    #[serde(default)]
    pub event: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Errors returned by [`parse_webhook`].
#[derive(Debug, thiserror::Error)]
pub enum WebhookError {
    #[error("paycrest webhook: missing signature")]
    MissingSignature,
    #[error("paycrest webhook: invalid signature")]
    InvalidSignature,
    #[error("paycrest webhook: invalid JSON body: {0}")]
    InvalidBody(#[from] serde_json::Error),
}

/// Verify the HMAC-SHA256 signature of `raw_body` against `secret` and
/// decode the envelope on success. `signature` is typically the value
/// of the `X-Paycrest-Signature` request header.
pub fn parse_webhook(
    raw_body: &[u8],
    signature: Option<&str>,
    secret: &str,
) -> Result<WebhookEvent, WebhookError> {
    let Some(sig) = signature else {
        return Err(WebhookError::MissingSignature);
    };
    let body_str = std::str::from_utf8(raw_body).map_err(|e| {
        WebhookError::InvalidBody(serde_json::Error::io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            e,
        )))
    })?;
    if !verify_webhook_signature(body_str, sig, secret) {
        return Err(WebhookError::InvalidSignature);
    }
    Ok(serde_json::from_str(body_str)?)
}
