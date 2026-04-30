//! Cross-SDK parity client (Rust).

use paycrest_sdk::{ClientOptions, PaycrestClient};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let base_url = std::env::var("PAYCREST_BASE_URL")
        .map_err(|_| "PAYCREST_BASE_URL is required")?;

    let client = PaycrestClient::new_with_options(ClientOptions {
        sender_api_key: Some("parity-key".to_string()),
        base_url,
        ..Default::default()
    });

    let sender = client.sender()?;
    let order = sender
        .create_offramp_order(json!({
            "amount": "100",
            "source": {
                "type": "crypto",
                "currency": "USDT",
                "network": "base",
                "refundAddress": "0xabc"
            },
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
        }))
        .await?;

    if order.id.is_empty() {
        eprintln!("rust-client: no order id returned");
        std::process::exit(2);
    }
    let refreshed = sender.get_order(&order.id).await?;
    if refreshed.status != "settled" {
        eprintln!("rust-client: unexpected status {}", refreshed.status);
        std::process::exit(3);
    }
    println!("rust-client: OK");
    Ok(())
}
