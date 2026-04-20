use reqwest::Method;
use serde_json::{json, Value};

use crate::client::{ClientHttp, RequestExecutor};
use crate::error::PaycrestError;
use crate::models::{ListOrdersResponse, PaymentOrder, RateQuoteResponse, SenderStats};

#[derive(Clone)]
pub struct SenderClient {
    http: ClientHttp,
}

impl SenderClient {
    pub(crate) fn new(http: ClientHttp) -> Self {
        Self { http }
    }

    pub async fn create_order(&self, payload: Value) -> Result<PaymentOrder, PaycrestError> {
        let source_type = payload
            .get("source")
            .and_then(|s| s.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let destination_type = payload
            .get("destination")
            .and_then(|d| d.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        if source_type == "crypto" && destination_type == "fiat" {
            return self.create_offramp_order(payload).await;
        }
        if source_type == "fiat" && destination_type == "crypto" {
            return self.create_onramp_order(payload).await;
        }

        Err(PaycrestError::Api {
            status_code: 400,
            message: "invalid sender order direction".to_string(),
            details: None,
        })
    }

    pub async fn create_offramp_order(
        &self,
        payload: Value,
    ) -> Result<PaymentOrder, PaycrestError> {
        let prepared = self
            .with_resolved_rate(
                payload,
                rate_input(
                    self.read(&payload, &["source", "network"]),
                    self.read(&payload, &["source", "currency"]),
                    self.read(&payload, &["amount"]),
                    self.read(&payload, &["destination", "currency"]),
                    "sell",
                ),
            )
            .await?;

        let response = self
            .http
            .request(
                Method::POST,
                "/sender/orders".to_string(),
                None,
                Some(prepared),
            )
            .await?;
        Ok(response.data)
    }

    pub async fn create_onramp_order(&self, payload: Value) -> Result<PaymentOrder, PaycrestError> {
        let prepared = self
            .with_resolved_rate(
                payload,
                rate_input(
                    self.read(&payload, &["destination", "recipient", "network"]),
                    self.read(&payload, &["destination", "currency"]),
                    self.read(&payload, &["amount"]),
                    self.read(&payload, &["source", "currency"]),
                    "buy",
                ),
            )
            .await?;

        let response = self
            .http
            .request(
                Method::POST,
                "/sender/orders".to_string(),
                None,
                Some(prepared),
            )
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
            .http
            .request(Method::GET, "/sender/orders".to_string(), Some(query), None)
            .await?;
        Ok(response.data)
    }

    pub async fn get_order(&self, order_id: &str) -> Result<PaymentOrder, PaycrestError> {
        let path = format!("/sender/orders/{order_id}");
        let response = self.http.request(Method::GET, path, None, None).await?;
        Ok(response.data)
    }

    pub async fn get_stats(&self) -> Result<SenderStats, PaycrestError> {
        let response = self
            .http
            .request(Method::GET, "/sender/stats".to_string(), None, None)
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
            .http
            .request(
                Method::POST,
                "/verify-account".to_string(),
                None,
                Some(payload),
            )
            .await?;
        Ok(response.data)
    }

    pub async fn get_token_rate(
        &self,
        network: &str,
        token: &str,
        amount: &str,
        fiat: &str,
        side: Option<&str>,
        provider_id: Option<&str>,
    ) -> Result<RateQuoteResponse, PaycrestError> {
        let path = format!("/rates/{network}/{token}/{amount}/{fiat}");
        let mut query = Vec::new();
        if let Some(s) = side {
            query.push(("side", s.to_string()));
        }
        if let Some(pid) = provider_id {
            query.push(("provider_id", pid.to_string()));
        }

        let response = self
            .http
            .request(
                Method::GET,
                path,
                if query.is_empty() { None } else { Some(query) },
                None,
            )
            .await?;
        Ok(response.data)
    }

    async fn with_resolved_rate(
        &self,
        payload: Value,
        input: RateInput,
    ) -> Result<Value, PaycrestError> {
        if payload.get("rate").and_then(|v| v.as_str()).is_some() {
            return Ok(payload);
        }

        let quote = self
            .get_token_rate(
                &input.network,
                &input.token,
                &input.amount,
                &input.fiat,
                Some(&input.side),
                None,
            )
            .await?;

        let rate = match input.side.as_str() {
            "buy" => quote.buy.as_ref().map(|q| q.rate.clone()),
            "sell" => quote.sell.as_ref().map(|q| q.rate.clone()),
            _ => None,
        };

        let Some(rate) = rate else {
            return Err(PaycrestError::MissingRateQuote);
        };

        let mut prepared = payload;
        if let Some(obj) = prepared.as_object_mut() {
            obj.insert("rate".to_string(), Value::String(rate));
        }
        Ok(prepared)
    }

    fn read(&self, payload: &Value, path: &[&str]) -> String {
        let mut current = payload;
        for key in path {
            let Some(next) = current.get(*key) else {
                return String::new();
            };
            current = next;
        }

        match current {
            Value::String(v) => v.clone(),
            Value::Number(v) => v.to_string(),
            _ => String::new(),
        }
    }
}

struct RateInput {
    network: String,
    token: String,
    amount: String,
    fiat: String,
    side: String,
}

fn rate_input(
    network: String,
    token: String,
    amount: String,
    fiat: String,
    side: &str,
) -> RateInput {
    RateInput {
        network,
        token,
        amount,
        fiat,
        side: side.to_string(),
    }
}
