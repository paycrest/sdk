use reqwest::Method;
use serde_json::{json, Value};

use crate::client::PaycrestClient;
use crate::error::PaycrestError;
use crate::models::{ListOrdersResponse, PaymentOrder, SenderStats};

#[derive(Clone)]
pub struct SenderClient {
    client: PaycrestClient,
}

impl SenderClient {
    pub(crate) fn new(client: PaycrestClient) -> Self {
        Self { client }
    }

    pub async fn create_order(&self, payload: Value) -> Result<PaymentOrder, PaycrestError> {
        let response = self
            .client
            .request(Method::POST, "/sender/orders", None, Some(payload))
            .await?;
        Ok(response.data)
    }

    pub async fn list_orders(
        &self,
        page: i64,
        page_size: i64,
        status: Option<&str>,
    ) -> Result<ListOrdersResponse, PaycrestError> {
        let mut query = vec![
            ("page", page.to_string()),
            ("pageSize", page_size.to_string()),
        ];
        if let Some(s) = status {
            query.push(("status", s.to_string()));
        }

        let response = self
            .client
            .request(Method::GET, "/sender/orders", Some(&query), None)
            .await?;
        Ok(response.data)
    }

    pub async fn get_order(&self, order_id: &str) -> Result<PaymentOrder, PaycrestError> {
        let path = format!("/sender/orders/{order_id}");
        let response = self.client.request(Method::GET, &path, None, None).await?;
        Ok(response.data)
    }

    pub async fn get_stats(&self) -> Result<SenderStats, PaycrestError> {
        let response = self
            .client
            .request(Method::GET, "/sender/stats", None, None)
            .await?;
        Ok(response.data)
    }

    pub async fn verify_account(
        &self,
        institution: &str,
        account_identifier: &str,
    ) -> Result<String, PaycrestError> {
        let payload = json!({
            "institution": institution,
            "accountIdentifier": account_identifier,
        });
        let response = self
            .client
            .request(Method::POST, "/verify-account", None, Some(payload))
            .await?;
        Ok(response.data)
    }
}
