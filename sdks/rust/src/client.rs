use std::sync::Arc;
use std::time::Duration;

use rand::Rng;
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::{classify_kind, ErrorKind, PaycrestError};
use crate::gateway::{GatewayClient, GatewayPathConfig};
use crate::models::ApiResponse;
use crate::registry::AggregatorRegistry;

pub const DEFAULT_BASE_URL: &str = "https://api.paycrest.io/v2";

/// Retry policy applied to HTTP requests. Matches the semantics of the
/// TypeScript / Python / Go SDKs: GETs retry on transport + retryable
/// server errors, POSTs only on transport errors.
#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            retries: 3,
            base_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(10),
        }
    }
}

const RETRYABLE_STATUS: [u16; 6] = [408, 429, 500, 502, 503, 504];

/// Per-request observation context handed to each hook.
#[derive(Debug, Clone)]
pub struct HookContext {
    pub method: String,
    pub url: String,
    pub attempt: u32,
    pub idempotency_key: Option<String>,
    pub status_code: Option<u16>,
    pub duration: Option<std::time::Duration>,
    pub error: Option<String>,
}

/// Request hooks let integrators plug in logging / metrics / tracing
/// without forking. All hooks are passive — errors inside hooks are
/// swallowed.
#[derive(Clone, Default)]
pub struct RequestHooks {
    pub on_request: Option<std::sync::Arc<dyn Fn(&HookContext) + Send + Sync>>,
    pub on_response: Option<std::sync::Arc<dyn Fn(&HookContext) + Send + Sync>>,
    pub on_error: Option<std::sync::Arc<dyn Fn(&HookContext) + Send + Sync>>,
}

impl std::fmt::Debug for RequestHooks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RequestHooks")
            .field("on_request", &self.on_request.is_some())
            .field("on_response", &self.on_response.is_some())
            .field("on_error", &self.on_error.is_some())
            .finish()
    }
}

impl RequestHooks {
    fn fire(&self, cb: &Option<std::sync::Arc<dyn Fn(&HookContext) + Send + Sync>>, ctx: &HookContext) {
        if let Some(hook) = cb {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| hook(ctx)));
        }
    }
}

#[derive(Clone)]
pub(crate) struct HttpContext {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
    retry_policy: RetryPolicy,
    hooks: RequestHooks,
}

impl HttpContext {
    pub(crate) fn new(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
        retry_policy: RetryPolicy,
        hooks: RequestHooks,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            base_url: base_url.into(),
            http: reqwest::Client::new(),
            retry_policy,
            hooks,
        }
    }

    pub(crate) async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
    ) -> Result<ApiResponse<T>, PaycrestError> {
        self.request_with_idempotency(method, path, query, body, None).await
    }

    /// Internal variant used by POST sites to thread an Idempotency-Key
    /// through the retry loop. Zero-value `idempotency_key` + POST
    /// method auto-generates a UUID.
    pub(crate) async fn request_with_idempotency<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
        idempotency_key: Option<String>,
    ) -> Result<ApiResponse<T>, PaycrestError> {
        let effective_key = match idempotency_key {
            Some(k) if !k.is_empty() => Some(k),
            _ if method == Method::POST => Some(uuid::Uuid::new_v4().to_string()),
            _ => None,
        };
        let mut last: Option<PaycrestError> = None;
        for attempt in 1..=self.retry_policy.retries {
            let mut ctx = HookContext {
                method: method.as_str().to_string(),
                url: format!("{}{}", self.base_url.trim_end_matches('/'), path),
                attempt,
                idempotency_key: effective_key.clone(),
                status_code: None,
                duration: None,
                error: None,
            };
            self.hooks.fire(&self.hooks.on_request, &ctx);
            let start = std::time::Instant::now();
            match self
                .send_once::<T>(method.clone(), path, query, body.clone(), effective_key.as_deref())
                .await
            {
                Ok(resp) => {
                    ctx.duration = Some(start.elapsed());
                    ctx.status_code = Some(200);
                    self.hooks.fire(&self.hooks.on_response, &ctx);
                    return Ok(resp);
                }
                Err(err) => {
                    ctx.duration = Some(start.elapsed());
                    if let PaycrestError::Api { status_code, .. } = &err {
                        ctx.status_code = Some(*status_code);
                    }
                    ctx.error = Some(err.to_string());
                    self.hooks.fire(&self.hooks.on_error, &ctx);
                    let retryable = self.is_retryable(&err, &method);
                    last = Some(err);
                    if attempt >= self.retry_policy.retries {
                        break;
                    }
                    if !retryable {
                        break;
                    }
                    let delay = self.compute_backoff(attempt, last.as_ref().unwrap());
                    tokio::time::sleep(delay).await;
                }
            }
        }
        Err(last.unwrap_or_else(|| PaycrestError::api(0, "unknown http failure", None)))
    }

    async fn send_once<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
        idempotency_key: Option<&str>,
    ) -> Result<ApiResponse<T>, PaycrestError> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let mut builder = self
            .http
            .request(method, &url)
            .header("Content-Type", "application/json");
        if !self.api_key.is_empty() {
            builder = builder.header("API-Key", &self.api_key);
        }
        if let Some(key) = idempotency_key {
            builder = builder.header("Idempotency-Key", key);
        }
        if let Some(q) = query {
            builder = builder.query(q);
        }
        if let Some(b) = body {
            builder = builder.json(&b);
        }

        let response = builder.send().await.map_err(|e| {
            PaycrestError::api_with_kind(0, format!("network error: {e}"), None, ErrorKind::Network)
        })?;
        let status = response.status();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<f64>().ok());
        let text = response.text().await.map_err(|e| {
            PaycrestError::api_with_kind(0, format!("body read: {e}"), None, ErrorKind::Network)
        })?;

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
                kind: classify_kind(status.as_u16()),
                retry_after_seconds: retry_after,
            });
        }

        Ok(serde_json::from_str(&text)?)
    }

    fn is_retryable(&self, err: &PaycrestError, method: &Method) -> bool {
        match err {
            PaycrestError::Api { kind, status_code, .. } => {
                if *kind == ErrorKind::Network {
                    return true;
                }
                if method != Method::GET {
                    return false;
                }
                RETRYABLE_STATUS.contains(status_code)
            }
            PaycrestError::Http(_) => true,
            _ => false,
        }
    }

    fn compute_backoff(&self, attempt: u32, err: &PaycrestError) -> Duration {
        if let PaycrestError::Api {
            kind: ErrorKind::RateLimit,
            retry_after_seconds: Some(secs),
            ..
        } = err
        {
            let wait = Duration::from_secs_f64(*secs);
            return std::cmp::min(wait, self.retry_policy.max_delay);
        }
        let exponent = self.retry_policy.base_delay * 2_u32.pow(attempt - 1);
        let jitter_ms = {
            let mut rng = rand::thread_rng();
            rng.gen_range(0..=exponent.as_millis() as u64)
        };
        let wait = Duration::from_millis(jitter_ms);
        std::cmp::min(wait, self.retry_policy.max_delay)
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
            retry_policy: RetryPolicy::default(),
            hooks: RequestHooks::default(),
            gateway: None,
        })
    }

    pub fn new_with_options(options: ClientOptions) -> Self {
        let sender_key = options.sender_api_key.or_else(|| options.api_key.clone());
        let provider_key = options.provider_api_key.or(options.api_key);
        let policy = options.retry_policy;
        let hooks = options.hooks.clone();

        let sender_http = sender_key.map(|k| HttpContext::new(k, options.base_url.clone(), policy, hooks.clone()));
        let provider_http = provider_key.map(|k| HttpContext::new(k, options.base_url.clone(), policy, hooks.clone()));
        let public_http = HttpContext::new(String::new(), options.base_url.clone(), policy, hooks);

        let pubkey_override = options
            .gateway
            .as_ref()
            .and_then(|g| g.aggregator_public_key.clone());
        let registry = Arc::new(AggregatorRegistry::new(public_http.clone(), pubkey_override));

        let gateway_client = options
            .gateway
            .map(|cfg| Arc::new(GatewayClient::new(Arc::clone(&registry), cfg)));

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

pub struct ClientOptions {
    pub api_key: Option<String>,
    pub sender_api_key: Option<String>,
    pub provider_api_key: Option<String>,
    pub base_url: String,
    pub retry_policy: RetryPolicy,
    pub hooks: RequestHooks,
    pub gateway: Option<GatewayPathConfig>,
}

impl Default for ClientOptions {
    fn default() -> Self {
        Self {
            api_key: None,
            sender_api_key: None,
            provider_api_key: None,
            base_url: DEFAULT_BASE_URL.to_string(),
            retry_policy: RetryPolicy::default(),
            hooks: RequestHooks::default(),
            gateway: None,
        }
    }
}
