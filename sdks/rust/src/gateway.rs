//! Direct-contract off-ramp path.
//!
//! The SDK handles network/token metadata resolution and recipient
//! encryption, then delegates signing + broadcast to a caller-supplied
//! [`GatewayTransactor`]. An ethers-rs adapter ships as an optional
//! sibling module (see `examples/ethers_transactor.rs`).

use async_trait::async_trait;
use num_bigint::BigUint;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::encryption::{build_recipient_payload, encrypt_recipient_payload};
use crate::error::PaycrestError;
use crate::networks::get_network;
use crate::registry::AggregatorRegistry;

#[derive(Debug, Clone)]
pub struct GatewayCreateOrderArgs {
    pub token: String,
    pub amount: BigUint,
    pub rate: BigUint,
    pub sender_fee_recipient: String,
    pub sender_fee: BigUint,
    pub refund_address: String,
    pub message_hash: String,
}

#[async_trait]
pub trait GatewayTransactor: Send + Sync {
    async fn chain_id(&self) -> Result<u64, PaycrestError>;
    fn from(&self) -> String;
    async fn allowance(
        &self,
        token: &str,
        owner: &str,
        spender: &str,
    ) -> Result<BigUint, PaycrestError>;
    async fn approve(
        &self,
        token: &str,
        spender: &str,
        amount: BigUint,
    ) -> Result<String, PaycrestError>;
    async fn create_order(
        &self,
        gateway: &str,
        args: GatewayCreateOrderArgs,
    ) -> Result<String, PaycrestError>;
}

pub struct GatewayPathConfig {
    pub transactor: std::sync::Arc<dyn GatewayTransactor>,
    pub aggregator_public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayOrderResult {
    pub tx_hash: String,
    pub approve_tx_hash: Option<String>,
    pub gateway_address: String,
    pub token_address: String,
    pub amount: String,
    pub rate: String,
    pub message_hash: String,
    pub refund_address: String,
    pub network: String,
}

pub struct GatewayClient {
    registry: std::sync::Arc<AggregatorRegistry>,
    config: GatewayPathConfig,
}

impl GatewayClient {
    pub fn new(
        registry: std::sync::Arc<AggregatorRegistry>,
        config: GatewayPathConfig,
    ) -> Self {
        Self { registry, config }
    }

    pub async fn create_offramp_order<F, Fut>(
        &self,
        payload: &serde_json::Value,
        rate_resolver: F,
    ) -> Result<GatewayOrderResult, PaycrestError>
    where
        F: Fn(String, String, String, String) -> Fut,
        Fut: std::future::Future<Output = Result<String, PaycrestError>>,
    {
        let source = payload.get("source").ok_or_else(|| api_err(400, "payload.source is required"))?;
        let dest = payload.get("destination").ok_or_else(|| api_err(400, "payload.destination is required"))?;

        let network_slug = source.get("network").and_then(|v| v.as_str()).ok_or_else(|| {
            api_err(400, "source.network is required")
        })?;
        let network = get_network(network_slug).map_err(|m| api_err(400, &m))?;

        let signer_chain = self.config.transactor.chain_id().await?;
        if signer_chain != 0 && signer_chain != network.chain_id {
            return Err(api_err(
                400,
                &format!(
                    "transactor chainId={signer_chain} does not match network \"{}\" (chainId={})",
                    network.slug, network.chain_id
                ),
            ));
        }

        let token_symbol = source.get("currency").and_then(|v| v.as_str()).ok_or_else(|| {
            api_err(400, "source.currency is required")
        })?;
        let token = self.registry.get_token(network.slug, token_symbol).await?;

        let amount_str = payload
            .get("amount")
            .and_then(|v| v.as_str())
            .ok_or_else(|| api_err(400, "amount is required"))?;
        let fiat = dest
            .get("currency")
            .and_then(|v| v.as_str())
            .ok_or_else(|| api_err(400, "destination.currency is required"))?;

        let rate = if let Some(r) = payload.get("rate").and_then(|v| v.as_str()) {
            r.to_string()
        } else {
            rate_resolver(
                network.slug.to_string(),
                token_symbol.to_string(),
                amount_str.to_string(),
                fiat.to_string(),
            )
            .await?
        };

        let recipient = dest
            .get("recipient")
            .ok_or_else(|| api_err(400, "destination.recipient is required"))?;
        let payload_struct = build_recipient_payload(
            recipient.get("institution").and_then(|v| v.as_str()).unwrap_or(""),
            recipient.get("accountIdentifier").and_then(|v| v.as_str()).unwrap_or(""),
            recipient.get("accountName").and_then(|v| v.as_str()).unwrap_or(""),
            recipient.get("memo").and_then(|v| v.as_str()).unwrap_or(""),
            dest.get("providerId").and_then(|v| v.as_str()).unwrap_or(""),
            None,
        );

        let public_key = self.registry.get_public_key().await?;
        let message_hash = encrypt_recipient_payload(&payload_struct, &public_key)?;

        let amount_sub = to_subunits(amount_str, token.decimals)?;
        let fee_sub = if let Some(fee_str) = payload.get("senderFee").and_then(|v| v.as_str()) {
            to_subunits(fee_str, token.decimals)?
        } else {
            BigUint::from(0u64)
        };
        let rate_scaled = scale_rate(&rate)?;

        let refund_address = payload
            .get("source")
            .and_then(|v| v.get("refundAddress"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| self.config.transactor.from());

        let sender_fee_recipient = payload
            .get("senderFeeRecipient")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "0x0000000000000000000000000000000000000000".to_string());

        let mut approve_tx_hash: Option<String> = None;
        let needed = &amount_sub + &fee_sub;
        if needed > BigUint::from(0u64) {
            let current = self
                .config
                .transactor
                .allowance(&token.contract_address, &self.config.transactor.from(), network.gateway)
                .await?;
            if current < needed {
                approve_tx_hash = Some(
                    self.config
                        .transactor
                        .approve(&token.contract_address, network.gateway, needed.clone())
                        .await?,
                );
            }
        }

        let tx_hash = self
            .config
            .transactor
            .create_order(
                network.gateway,
                GatewayCreateOrderArgs {
                    token: token.contract_address.clone(),
                    amount: amount_sub.clone(),
                    rate: rate_scaled,
                    sender_fee_recipient,
                    sender_fee: fee_sub,
                    refund_address: refund_address.clone(),
                    message_hash: message_hash.clone(),
                },
            )
            .await?;

        Ok(GatewayOrderResult {
            tx_hash,
            approve_tx_hash,
            gateway_address: network.gateway.to_string(),
            token_address: token.contract_address,
            amount: amount_sub.to_string(),
            rate,
            message_hash,
            refund_address,
            network: network.slug.to_string(),
        })
    }
}

fn api_err(status: u16, msg: &str) -> PaycrestError {
    PaycrestError::Api {
        status_code: status,
        message: msg.to_string(),
        details: None,
    }
}

fn decimal_regex() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d+(\.\d+)?$").unwrap())
}

/// Convert a positive decimal string amount into integer base units.
pub fn to_subunits(amount: &str, decimals: u32) -> Result<BigUint, PaycrestError> {
    let trimmed = amount.trim();
    if !decimal_regex().is_match(trimmed) {
        return Err(api_err(400, &format!("invalid amount \"{amount}\"")));
    }
    let mut parts = trimmed.splitn(2, '.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next().unwrap_or("");
    if fraction.len() as u32 > decimals {
        return Err(api_err(
            400,
            &format!(
                "amount \"{amount}\" has more fractional digits than token decimals ({decimals})"
            ),
        ));
    }
    let mut padded = String::from(whole);
    padded.push_str(fraction);
    for _ in 0..(decimals as usize - fraction.len()) {
        padded.push('0');
    }
    padded
        .parse::<BigUint>()
        .map_err(|e| api_err(400, &format!("invalid subunits parse: {e}")))
}

/// Scale a decimal-string rate to the uint96 the Gateway expects.
pub fn scale_rate(rate: &str) -> Result<BigUint, PaycrestError> {
    let trimmed = rate.trim();
    if !decimal_regex().is_match(trimmed) {
        return Err(api_err(400, &format!("invalid rate \"{rate}\"")));
    }
    let mut parts = trimmed.splitn(2, '.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next().unwrap_or("");
    if fraction.len() <= 2 {
        let mut padded = String::from(whole);
        padded.push_str(fraction);
        for _ in 0..(2 - fraction.len()) {
            padded.push('0');
        }
        return padded
            .parse::<BigUint>()
            .map_err(|e| api_err(400, &format!("invalid rate parse: {e}")));
    }
    let mut shifted = String::from(whole);
    shifted.push_str(&fraction[..2]);
    let mut value: BigUint = shifted
        .parse()
        .map_err(|e| api_err(400, &format!("invalid rate parse: {e}")))?;
    let round_digit = fraction.as_bytes()[2] - b'0';
    if round_digit >= 5 {
        value += 1u32;
    }
    Ok(value)
}
