pub mod client;
pub mod error;
pub mod models;
pub mod provider;
pub mod sender;
pub mod webhooks;

pub use client::PaycrestClient;
pub use error::PaycrestError;
pub use provider::ProviderClient;
pub use sender::SenderClient;

#[cfg(test)]
mod tests {
    use crate::webhooks::verify_webhook_signature;

    #[test]
    fn verifies_webhook_signature() {
        let body = "{\"status\":\"settled\"}";
        let secret = "secret";
        let signature = "5297f06742797b696288bfc36b02479e87d448dd38a2d88db49731486c666187";

        assert!(verify_webhook_signature(body, signature, secret));
        assert!(!verify_webhook_signature(body, "bad", secret));
    }
}
