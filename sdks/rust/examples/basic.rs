use paycrest_sdk::{client::ClientOptions, PaycrestClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = PaycrestClient::new_with_options(ClientOptions {
        sender_api_key: Some(std::env::var("PAYCREST_SENDER_API_KEY")?),
        ..Default::default()
    });

    let sender = client.sender()?;
    let stats = sender.get_stats().await?;
    println!("stats = {:?}", stats);
    Ok(())
}
