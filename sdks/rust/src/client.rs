use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::PaycrestError;
use crate::models::ApiResponse;

pub const DEFAULT_BASE_URL: &str = "https://api.paycrest.io/v2";

#[derive(Clone)]
pub struct PaycrestClient {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
}

impl PaycrestClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            base_url: DEFAULT_BASE_URL.to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    pub fn sender(&self) -> crate::sender::SenderClient {
        crate::sender::SenderClient::new(self.clone())
    }

    pub fn provider(&self) -> Result<(), PaycrestError> {
        Err(PaycrestError::ProviderUnavailable)
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
            .header("API-Key", &self.api_key)
            .header("Content-Type", "application/json");

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
