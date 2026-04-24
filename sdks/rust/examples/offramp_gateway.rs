//! Off-ramp via the direct Gateway contract path (OfframpMethod::Gateway).
//!
//! The Rust SDK delegates signing + broadcasting to a caller-supplied
//! [`GatewayTransactor`] trait object. The snippet below shows the
//! shape of an ethers-rs adapter — drop it into your integrator and
//! wire up the wallet / provider as usual.

use std::sync::Arc;

use async_trait::async_trait;
use num_bigint::BigUint;
use paycrest_sdk::{
    ClientOptions, GatewayCreateOrderArgs, GatewayPathConfig, GatewayTransactor, OfframpMethod,
    OfframpOrderOutcome, PaycrestClient, PaycrestError,
};
use serde_json::json;

struct DummyTransactor;

#[async_trait]
impl GatewayTransactor for DummyTransactor {
    async fn chain_id(&self) -> Result<u64, PaycrestError> {
        Ok(8453)
    }

    fn from(&self) -> String {
        "0xSenderEoa".to_string()
    }

    async fn allowance(
        &self,
        _token: &str,
        _owner: &str,
        _spender: &str,
    ) -> Result<BigUint, PaycrestError> {
        Ok(BigUint::from(0u64))
    }

    async fn approve(
        &self,
        _token: &str,
        _spender: &str,
        _amount: BigUint,
    ) -> Result<String, PaycrestError> {
        Ok("0xApproveTxHash".to_string())
    }

    async fn create_order(
        &self,
        _gateway: &str,
        _args: GatewayCreateOrderArgs,
    ) -> Result<String, PaycrestError> {
        Ok("0xCreateTxHash".to_string())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = PaycrestClient::new_with_options(ClientOptions {
        sender_api_key: Some("sender-key".to_string()),
        base_url: paycrest_sdk::DEFAULT_BASE_URL.to_string(),
        gateway: Some(GatewayPathConfig {
            transactor: Arc::new(DummyTransactor),
            aggregator_public_key: None,
        }),
        ..Default::default()
    });

    let sender = client.sender()?;
    let payload = json!({
        "amount": "100",
        "rate": "1500",
        "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xSenderEoa"},
        "destination": {
            "type": "fiat",
            "currency": "NGN",
            "recipient": {
                "institution": "GTBINGLA",
                "accountIdentifier": "1234567890",
                "accountName": "Jane Doe",
                "memo": "Payout"
            }
        }
    });

    match sender.create_offramp_order_with_method(payload, OfframpMethod::Gateway).await? {
        OfframpOrderOutcome::Gateway(result) => println!("{:?}", result),
        OfframpOrderOutcome::Api(_) => unreachable!(),
    }
    Ok(())
}
