use std::sync::Arc;

use reqwest::Method;
use serde_json::{json, Value};

use crate::client::HttpContext;
use crate::error::PaycrestError;
use crate::gateway::{GatewayClient, GatewayOrderResult};
use crate::models::{ListOrdersResponse, PaymentOrder, RateQuoteResponse, SenderStats};

/// Result of [`SenderClient::create_offramp_order`] — carries either
/// the aggregator-managed payment order (API dispatch) or the on-chain
/// transaction envelope (gateway dispatch), never both.
pub enum OfframpOrderOutcome {
    Api(PaymentOrder),
    Gateway(GatewayOrderResult),
}

/// Selects how an off-ramp order is dispatched. Defaults to `Api`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OfframpMethod {
    #[default]
    Api,
    Gateway,
}

#[derive(Clone)]
pub struct SenderClient {
    http: HttpContext,
    public_http: HttpContext,
    gateway_client: Option<Arc<GatewayClient>>,
}

impl SenderClient {
    pub(crate) fn new(
        http: HttpContext,
        public_http: HttpContext,
        gateway_client: Option<Arc<GatewayClient>>,
    ) -> Self {
        Self { http, public_http, gateway_client }
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

    /// Create an off-ramp order via the aggregator API path (backwards
    /// compatible; equivalent to `create_offramp_order_with_method(...,
    /// OfframpMethod::Api)` unwrapped into the payment order).
    pub async fn create_offramp_order(
        &self,
        payload: Value,
    ) -> Result<PaymentOrder, PaycrestError> {
        let network = self.read(&payload, &["source", "network"]);
        let token = self.read(&payload, &["source", "currency"]);
        let amount = self.read(&payload, &["amount"]);
        let fiat = self.read(&payload, &["destination", "currency"]);
        let prepared = self
            .with_resolved_rate(payload, rate_input(network, token, amount, fiat, "sell"))
            .await?;

        let response = self
            .http
            .request(Method::POST, "/sender/orders", None, Some(prepared))
            .await?;
        Ok(response.data)
    }

    /// Create an off-ramp order, dispatching through the aggregator API
    /// (default) or directly to the on-chain Gateway contract via the
    /// transactor configured on the client.
    pub async fn create_offramp_order_with_method(
        &self,
        payload: Value,
        method: OfframpMethod,
    ) -> Result<OfframpOrderOutcome, PaycrestError> {
        match method {
            OfframpMethod::Api => {
                let order = self.create_offramp_order(payload).await?;
                Ok(OfframpOrderOutcome::Api(order))
            }
            OfframpMethod::Gateway => {
                let gateway = self.gateway_client.as_ref().ok_or_else(|| PaycrestError::Api {
                    status_code: 400,
                    message:
                        "gateway dispatch is not configured; pass ClientOptions::gateway when constructing the client"
                            .to_string(),
                    details: None,
                })?;
                let public_http = self.public_http.clone();
                let rate_resolver = move |network: String, token: String, amount: String, fiat: String| {
                    let public_http = public_http.clone();
                    async move {
                        let path = format!("/rates/{network}/{token}/{amount}/{fiat}");
                        let response = public_http
                            .request::<RateQuoteResponse>(
                                Method::GET,
                                &path,
                                Some(&[("side", "sell".to_string())]),
                                None,
                            )
                            .await?;
                        response
                            .data
                            .sell
                            .and_then(|q| Some(q.rate))
                            .filter(|r| !r.is_empty())
                            .ok_or(PaycrestError::MissingRateQuote)
                    }
                };
                let result = gateway
                    .create_offramp_order(&payload, rate_resolver)
                    .await?;
                Ok(OfframpOrderOutcome::Gateway(result))
            }
        }
    }

    pub async fn create_onramp_order(&self, payload: Value) -> Result<PaymentOrder, PaycrestError> {
        let network = self.read(&payload, &["destination", "recipient", "network"]);
        let token = self.read(&payload, &["destination", "currency"]);
        let amount = self.read(&payload, &["amount"]);
        let fiat = self.read(&payload, &["source", "currency"]);
        let prepared = self
            .with_resolved_rate(payload, rate_input(network, token, amount, fiat, "buy"))
            .await?;

        let response = self
            .http
            .request(Method::POST, "/sender/orders", None, Some(prepared))
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
            .request(Method::GET, "/sender/orders", Some(&query), None)
            .await?;
        Ok(response.data)
    }

    pub async fn get_order(&self, order_id: &str) -> Result<PaymentOrder, PaycrestError> {
        let path = format!("/sender/orders/{order_id}");
        let response = self.http.request(Method::GET, &path, None, None).await?;
        Ok(response.data)
    }

    pub async fn get_stats(&self) -> Result<SenderStats, PaycrestError> {
        let response = self
            .http
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
            .http
            .request(Method::POST, "/verify-account", None, Some(payload))
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
                &path,
                if query.is_empty() { None } else { Some(&query) },
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
