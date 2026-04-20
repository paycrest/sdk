use paycrest_sdk::PaycrestClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = PaycrestClient::new(std::env::var("PAYCREST_API_KEY")?);
    let stats = client.sender().get_stats().await?;
    println!("stats = {:?}", stats);
    Ok(())
}
