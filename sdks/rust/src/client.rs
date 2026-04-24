use std::sync::Arc;

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::PaycrestError;
use crate::gateway::{GatewayClient, GatewayPathConfig};
use crate::models::ApiResponse;
use crate::registry::AggregatorRegistry;

pub const DEFAULT_BASE_URL: &str = "https://api.paycrest.io/v2";

#[derive(Clone)]
pub(crate) struct HttpContext {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
}

impl HttpContext {
    fn new(api_key: impl Into<String>, base_url: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            base_url: base_url.into(),
            http: reqwest::Client::new(),
        }
    }

    pub(crate) async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
    ) -> Result<ApiResponse<T>, PaycrestError> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let mut builder = self
            .http
            .request(method, &url)
            .header("Content-Type", "application/json");
        if !self.api_key.is_empty() {
            builder = builder.header("API-Key", &self.api_key);
        }

        if let Some(q) = query {
            builder = builder.query(q);
        }

        if let Some(b) = body {
            builder = builder.json(&b);
        }

        let response = builder.send().await?;
        let status = response.status();
        let text = response.text().await?;

        if !status.is_success() {
            let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            let message = parsed
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Paycrest API request failed")
                .to_string();
            let details = parsed.get("data").cloned();
            return Err(PaycrestError::Api {
                status_code: status.as_u16(),
                message,
                details,
            });
        }

        Ok(serde_json::from_str(&text)?)
    }
}

pub struct PaycrestClient {
    sender_http: Option<HttpContext>,
    provider_http: Option<HttpContext>,
    public_http: HttpContext,
    #[allow(dead_code)]
    registry: Arc<AggregatorRegistry>,
    gateway_client: Option<Arc<GatewayClient>>,
}

impl PaycrestClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::new_with_options(ClientOptions {
            api_key: Some(api_key.into()),
            sender_api_key: None,
            provider_api_key: None,
            base_url: DEFAULT_BASE_URL.to_string(),
            gateway: None,
        })
    }

    pub fn new_with_options(options: ClientOptions) -> Self {
        let sender_key = options.sender_api_key.or_else(|| options.api_key.clone());
        let provider_key = options.provider_api_key.or(options.api_key);

        let sender_http = sender_key.map(|k| HttpContext::new(k, options.base_url.clone()));
        let provider_http = provider_key.map(|k| HttpContext::new(k, options.base_url.clone()));
        let public_http = HttpContext::new(String::new(), options.base_url.clone());

        let pubkey_override = options
            .gateway
            .as_ref()
            .and_then(|g| g.aggregator_public_key.clone());
        let registry = Arc::new(AggregatorRegistry::new(public_http.clone(), pubkey_override));

        let gateway_client = options.gateway.map(|cfg| {
            Arc::new(GatewayClient::new(Arc::clone(&registry), cfg))
        });

        Self {
            sender_http,
            provider_http,
            public_http,
            registry,
            gateway_client,
        }
    }

    pub fn sender(&self) -> Result<crate::sender::SenderClient, PaycrestError> {
        let Some(http) = self.sender_http.clone() else {
            return Err(PaycrestError::MissingSenderCredentials);
        };
        Ok(crate::sender::SenderClient::new(
            http,
            self.public_http.clone(),
            self.gateway_client.clone(),
        ))
    }

    pub fn provider(&self) -> Result<crate::provider::ProviderClient, PaycrestError> {
        let Some(http) = self.provider_http.clone() else {
            return Err(PaycrestError::MissingProviderCredentials);
        };
        Ok(crate::provider::ProviderClient::new(http))
    }
}

#[derive(Default)]
pub struct ClientOptions {
    pub api_key: Option<String>,
    pub sender_api_key: Option<String>,
    pub provider_api_key: Option<String>,
    pub base_url: String,
    pub gateway: Option<GatewayPathConfig>,
}
