pub mod client;
pub mod encryption;
pub mod error;
pub mod gateway;
pub mod models;
pub mod networks;
pub mod provider;
pub mod registry;
pub mod sender;
pub mod webhooks;

pub use client::{ClientOptions, PaycrestClient, DEFAULT_BASE_URL};
pub use encryption::{build_recipient_payload, encrypt_recipient_payload, RecipientPayload};
pub use error::PaycrestError;
pub use gateway::{
    scale_rate, to_subunits, GatewayClient, GatewayCreateOrderArgs, GatewayOrderResult,
    GatewayPathConfig, GatewayTransactor,
};
pub use networks::{get_network, register_network, NetworkInfo};
pub use provider::ProviderClient;
pub use registry::{AggregatorRegistry, SupportedToken};
pub use sender::{OfframpMethod, OfframpOrderOutcome, SenderClient};

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

#[cfg(test)]
mod contract_tests;
