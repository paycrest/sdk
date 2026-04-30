# paycrest-sdk

Official Paycrest SDK for Rust — sender, provider, and direct on-chain off-ramp via the Paycrest Gateway contract.

## Install

```toml
[dependencies]
paycrest-sdk = "2"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

## Quickstart

```rust
use paycrest_sdk::{ClientOptions, PaycrestClient};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = PaycrestClient::new_with_options(ClientOptions {
        sender_api_key: Some(std::env::var("PAYCREST_SENDER_API_KEY")?),
        ..Default::default()
    });
    let sender = client.sender()?;

    let order = sender.create_offramp_order(json!({
        "amount": "100",
        "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc..."},
        "destination": {
            "type": "fiat",
            "currency": "NGN",
            "recipient": {
                "institution": "GTBINGLA",
                "accountIdentifier": "1234567890",
                "accountName": "Jane Doe",
                "memo": "Invoice 42"
            }
        }
    })).await?;

    println!("send to {:?}", order.id);
    Ok(())
}
```

## Direct-contract off-ramp

The SDK is web3-library-agnostic. Implement `GatewayTransactor` (e.g. with ethers-rs / alloy) and pass it via `ClientOptions::gateway`. See `examples/offramp_gateway.rs` for a sketch.

## Full docs

- Repository: <https://github.com/paycrest/sdk>
- Step-by-step walkthrough: <https://github.com/paycrest/sdk/blob/main/docs/sandbox-walkthrough.md>
- Aggregator API reference: <https://docs.paycrest.io>

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`).
