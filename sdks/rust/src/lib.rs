pub mod client;
pub mod encryption;
pub mod error;
pub mod gateway;
pub mod models;
pub mod networks;
pub mod provider;
pub mod registry;
pub mod sender;
pub mod webhook_middleware;
pub mod webhooks;

pub use client::{
    ClientOptions, HookContext, PaycrestClient, RequestHooks, RetryPolicy, DEFAULT_BASE_URL,
};
pub use encryption::{build_recipient_payload, encrypt_recipient_payload, RecipientPayload};
pub use error::{ErrorKind, PaycrestError};
pub use gateway::{
    scale_rate, to_subunits, GatewayClient, GatewayCreateOrderArgs, GatewayOrderResult,
    GatewayPathConfig, GatewayTransactor,
};
pub use networks::{get_network, register_network, NetworkInfo};
pub use provider::ProviderClient;
pub use registry::{
    clear_registered_tokens, list_registered_tokens, register_token, register_tokens,
    AggregatorRegistry, SupportedToken,
};
pub use sender::{
    CreateOrderOptions, OfframpMethod, OfframpOrderOutcome, SenderClient, WaitForStatusOptions,
    WaitStatusTarget,
};
pub use webhook_middleware::{parse_webhook, WebhookError, WebhookEvent};

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

#[cfg(test)]
mod webhook_tests;
