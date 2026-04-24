//! In-memory cache for aggregator public key + token catalogue.

use std::collections::HashMap;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::client::HttpContext;
use crate::error::PaycrestError;

// HttpContext is pub(crate); AggregatorRegistry::new is therefore also
// internal (constructed by PaycrestClient). Expose it only to the
// crate.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportedToken {
    pub symbol: String,
    #[serde(rename = "contractAddress")]
    pub contract_address: String,
    pub decimals: u32,
    #[serde(rename = "baseCurrency")]
    pub base_currency: String,
    pub network: String,
}

pub struct AggregatorRegistry {
    http: HttpContext,
    public_key_override: Option<String>,
    public_key: RwLock<Option<String>>,
    tokens_by_network: RwLock<HashMap<String, Vec<SupportedToken>>>,
}

impl AggregatorRegistry {
    pub(crate) fn new(http: HttpContext, public_key_override: Option<String>) -> Self {
        Self {
            http,
            public_key_override,
            public_key: RwLock::new(None),
            tokens_by_network: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_public_key(&self) -> Result<String, PaycrestError> {
        if let Some(pem) = &self.public_key_override {
            return Ok(pem.clone());
        }
        if let Ok(guard) = self.public_key.read() {
            if let Some(pem) = guard.as_ref() {
                return Ok(pem.clone());
            }
        }
        let response = self
            .http
            .request::<String>(reqwest::Method::GET, "/pubkey", None, None)
            .await?;
        let pem = response.data;
        if pem.is_empty() {
            return Err(PaycrestError::api(500, "aggregator /pubkey returned empty PEM", None));
        }
        if let Ok(mut guard) = self.public_key.write() {
            *guard = Some(pem.clone());
        }
        Ok(pem)
    }

    pub async fn get_tokens_for_network(
        &self,
        network: &str,
    ) -> Result<Vec<SupportedToken>, PaycrestError> {
        let slug = network.to_lowercase();
        if let Ok(guard) = self.tokens_by_network.read() {
            if let Some(cached) = guard.get(&slug) {
                return Ok(cached.clone());
            }
        }
        let response = self
            .http
            .request::<Vec<SupportedToken>>(
                reqwest::Method::GET,
                "/tokens",
                Some(&[("network", slug.clone())]),
                None,
            )
            .await?;
        let tokens = response.data;
        if let Ok(mut guard) = self.tokens_by_network.write() {
            guard.insert(slug, tokens.clone());
        }
        Ok(tokens)
    }

    pub async fn get_token(
        &self,
        network: &str,
        symbol: &str,
    ) -> Result<SupportedToken, PaycrestError> {
        let tokens = self.get_tokens_for_network(network).await?;
        let want = symbol.to_uppercase();
        tokens
            .into_iter()
            .find(|t| t.symbol.to_uppercase() == want)
            .ok_or_else(|| {
                PaycrestError::api(
                    404,
                    format!("token \"{symbol}\" is not enabled on network \"{network}\""),
                    None,
                )
            })
    }
}
