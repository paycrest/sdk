use std::sync::Arc;
use std::time::Duration;

use reqwest::Method;
use serde_json::{json, Value};

use crate::client::HttpContext;
use crate::error::PaycrestError;
use crate::gateway::{GatewayClient, GatewayOrderResult};
use crate::models::{ListOrdersResponse, PaymentOrder, RateQuoteResponse, SenderStats};

const TERMINAL_STATUSES: &[&str] = &["settled", "refunded", "expired", "cancelled"];

/// Options for create-order calls.
#[derive(Default, Clone, Debug)]
pub struct CreateOrderOptions {
    /// Overrides the auto-generated UUID sent as the `Idempotency-Key`
    /// header. Use this to make retries across process boundaries share
    /// the same dedup key.
    pub idempotency_key: Option<String>,
}

fn ensure_reference(payload: Value) -> Value {
    let has_ref = payload
        .get("reference")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if has_ref {
        return payload;
    }
    let mut prepared = payload;
    if let Some(obj) = prepared.as_object_mut() {
        obj.insert(
            "reference".to_string(),
            Value::String(uuid::Uuid::new_v4().to_string()),
        );
    }
    prepared
}

/// Target status(es) for [`SenderClient::wait_for_status`].
#[derive(Clone, Copy, Debug)]
pub enum WaitStatusTarget<'a> {
    Single(&'a str),
    Any(&'a [&'a str]),
    Terminal,
}

/// Polling options for [`SenderClient::wait_for_status`].
#[derive(Default, Clone, Copy, Debug)]
pub struct WaitForStatusOptions {
    pub poll_interval: Option<Duration>,
    pub timeout: Option<Duration>,
}

fn matches_wait_target(status: &str, target: WaitStatusTarget<'_>) -> bool {
    match target {
        WaitStatusTarget::Single(s) => status == s,
        WaitStatusTarget::Any(list) => list.iter().any(|s| *s == status),
        WaitStatusTarget::Terminal => TERMINAL_STATUSES.contains(&status),
    }
}

fn describe_target(target: WaitStatusTarget<'_>) -> String {
    match target {
        WaitStatusTarget::Single(s) => s.to_string(),
        WaitStatusTarget::Any(list) => list.join("|"),
        WaitStatusTarget::Terminal => "a terminal status".to_string(),
    }
}

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

        Err(PaycrestError::api_with_kind(
            400,
            "invalid sender order direction",
            None,
            crate::error::ErrorKind::Validation,
        ))
    }

    /// Create an off-ramp order via the aggregator API path (backwards
    /// compatible; equivalent to `create_offramp_order_with_method(...,
    /// OfframpMethod::Api)` unwrapped into the payment order).
    pub async fn create_offramp_order(
        &self,
        payload: Value,
    ) -> Result<PaymentOrder, PaycrestError> {
        self.create_offramp_order_with_opts(payload, CreateOrderOptions::default()).await
    }

    /// Options-carrying variant of [`SenderClient::create_offramp_order`].
    pub async fn create_offramp_order_with_opts(
        &self,
        payload: Value,
        opts: CreateOrderOptions,
    ) -> Result<PaymentOrder, PaycrestError> {
        let network = self.read(&payload, &["source", "network"]);
        let token = self.read(&payload, &["source", "currency"]);
        let amount = self.read(&payload, &["amount"]);
        let fiat = self.read(&payload, &["destination", "currency"]);
        let prepared = self
            .with_resolved_rate(payload, rate_input(network, token, amount, fiat, "sell"))
            .await?;
        let prepared = ensure_reference(prepared);

        let response = self
            .http
            .request_with_idempotency(
                Method::POST,
                "/sender/orders",
                None,
                Some(prepared),
                opts.idempotency_key,
            )
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
                let gateway = self.gateway_client.as_ref().ok_or_else(|| {
                    PaycrestError::api_with_kind(
                        400,
                        "gateway dispatch is not configured; pass ClientOptions::gateway when constructing the client",
                        None,
                        crate::error::ErrorKind::Validation,
                    )
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
        self.create_onramp_order_with_opts(payload, CreateOrderOptions::default()).await
    }

    /// Options-carrying variant of [`SenderClient::create_onramp_order`].
    pub async fn create_onramp_order_with_opts(
        &self,
        payload: Value,
        opts: CreateOrderOptions,
    ) -> Result<PaymentOrder, PaycrestError> {
        let network = self.read(&payload, &["destination", "recipient", "network"]);
        let token = self.read(&payload, &["destination", "currency"]);
        let amount = self.read(&payload, &["amount"]);
        let fiat = self.read(&payload, &["source", "currency"]);
        let prepared = self
            .with_resolved_rate(payload, rate_input(network, token, amount, fiat, "buy"))
            .await?;
        let prepared = ensure_reference(prepared);

        let response = self
            .http
            .request_with_idempotency(
                Method::POST,
                "/sender/orders",
                None,
                Some(prepared),
                opts.idempotency_key,
            )
            .await?;
        Ok(response.data)
    }

    /// Collect every page of sender orders into a single `Vec`. Calls
    /// `list_orders` repeatedly with incrementing `page` until the
    /// response comes back empty or the cumulative count reaches the
    /// server-reported `total`. Caller is responsible for bounded
    /// memory if the dataset is large.
    pub async fn list_all_orders(
        &self,
        page_size: i64,
        status: Option<&str>,
    ) -> Result<Vec<PaymentOrder>, PaycrestError> {
        let mut out: Vec<PaymentOrder> = Vec::new();
        let mut page = 1i64;
        let effective_page_size = if page_size <= 0 { 50 } else { page_size };
        loop {
            let response = self.list_orders(page, effective_page_size, status).await?;
            if response.orders.is_empty() {
                return Ok(out);
            }
            out.extend(response.orders);
            if response.total > 0 && (out.len() as i64) >= response.total {
                return Ok(out);
            }
            page += 1;
        }
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

    /// Poll `get_order(order_id)` until the order reaches `target` or
    /// the timeout expires. `target` may be a specific status, a slice
    /// of statuses, or the literal string `"terminal"` (settled /
    /// refunded / expired / cancelled).
    pub async fn wait_for_status(
        &self,
        order_id: &str,
        target: WaitStatusTarget<'_>,
        options: WaitForStatusOptions,
    ) -> Result<PaymentOrder, PaycrestError> {
        let poll = options.poll_interval.unwrap_or(std::time::Duration::from_secs(3));
        let timeout = options.timeout.unwrap_or(std::time::Duration::from_secs(300));
        let deadline = std::time::Instant::now() + timeout;

        loop {
            let order = self.get_order(order_id).await?;
            let status = order.status.clone();
            if matches_wait_target(&status, target) {
                return Ok(order);
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                return Err(PaycrestError::api(
                    408,
                    format!(
                        "timed out waiting for order {order_id} to reach {}; last status={status}",
                        describe_target(target)
                    ),
                    None,
                ));
            }
            let remaining = deadline.saturating_duration_since(now);
            let sleep_for = std::cmp::min(poll, remaining);
            tokio::time::sleep(sleep_for).await;
        }
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
