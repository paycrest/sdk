use paycrest_sdk::client::{ClientOptions, PaycrestClient, DEFAULT_BASE_URL};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sender_key = std::env::var("PAYCREST_SENDER_API_KEY")
        .map_err(|_| "PAYCREST_SENDER_API_KEY is required")?;
    let provider_key = std::env::var("PAYCREST_PROVIDER_API_KEY")
        .map_err(|_| "PAYCREST_PROVIDER_API_KEY is required")?;
    let base_url = std::env::var("PAYCREST_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());

    let client = PaycrestClient::new_with_options(ClientOptions {
        sender_api_key: Some(sender_key),
        provider_api_key: Some(provider_key),
        base_url,
        ..Default::default()
    });

    let sender = client.sender()?;
    let provider = client.provider()?;

    let sender_stats = sender.get_stats().await?;
    let provider_stats = provider.get_stats(None).await?;

    let sender_total = sender_stats.total_orders;
    let provider_total = provider_stats.total_orders;

    println!(
        "rust integration passed (sender.total_orders={}, provider.total_orders={})",
        sender_total, provider_total
    );

    Ok(())
}
