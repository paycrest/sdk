#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [[ -z "${PAYCREST_BASE_URL:-}" ]]; then
    echo "PAYCREST_BASE_URL not set, skipping Rust integration test"
    exit 0
fi

if [[ -z "${PAYCREST_SENDER_API_KEY:-}" ]]; then
    echo "PAYCREST_SENDER_API_KEY not set, skipping Rust integration test"
    exit 0
fi

if [[ -z "${PAYCREST_PROVIDER_API_KEY:-}" ]]; then
    echo "PAYCREST_PROVIDER_API_KEY not set, skipping Rust integration test"
    exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
    echo "cargo is required for Rust integration tests."
    exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

cat > "$tmp_dir/Cargo.toml" <<'EOF'
[package]
name = "paycrest-live-integration"
version = "0.1.0"
edition = "2021"

[dependencies]
paycrest-sdk = { path = "/workspace/sdks/rust" }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
EOF

mkdir -p "$tmp_dir/src"
cat > "$tmp_dir/src/main.rs" <<'EOF'
use paycrest_sdk::client::{ClientOptions, PaycrestClient};

#[tokio::main]
async fn main() {
    let base_url = std::env::var("PAYCREST_BASE_URL").expect("PAYCREST_BASE_URL missing");
    let sender_key =
        std::env::var("PAYCREST_SENDER_API_KEY").expect("PAYCREST_SENDER_API_KEY missing");
    let provider_key =
        std::env::var("PAYCREST_PROVIDER_API_KEY").expect("PAYCREST_PROVIDER_API_KEY missing");

    let client = PaycrestClient::new_with_options(ClientOptions {
        api_key: None,
        sender_api_key: Some(sender_key),
        provider_api_key: Some(provider_key),
        base_url,
    });

    let sender = client.sender().expect("sender client");
    let sender_stats = sender.get_stats().await.expect("sender stats");
    println!("sender stats totalOrders={}", sender_stats.total_orders);

    let provider = client.provider().expect("provider client");
    let provider_stats = provider.get_stats(None).await.expect("provider stats");
    println!("provider stats totalOrders={}", provider_stats.total_orders);
}
EOF

(
    cd "$tmp_dir"
    cargo run --quiet
)

echo "Rust live integration passed"
