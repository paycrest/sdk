//! In-memory cache for aggregator public key + token catalogue.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde::{Deserialize, Serialize};

use crate::client::HttpContext;
use crate::error::PaycrestError;

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

fn static_tokens() -> &'static RwLock<HashMap<String, SupportedToken>> {
    static INSTANCE: OnceLock<RwLock<HashMap<String, SupportedToken>>> = OnceLock::new();
    INSTANCE.get_or_init(|| RwLock::new(HashMap::new()))
}

fn static_token_key(network: &str, symbol: &str) -> String {
    format!("{}::{}", network.to_lowercase(), symbol.to_uppercase())
}

/// Register a token statically so the gateway path resolves it without
/// hitting `/v2/tokens`.
pub fn register_token(token: SupportedToken) {
    if let Ok(mut guard) = static_tokens().write() {
        guard.insert(static_token_key(&token.network, &token.symbol), token);
    }
}

/// Bulk-register a list of tokens.
pub fn register_tokens(tokens: impl IntoIterator<Item = SupportedToken>) {
    if let Ok(mut guard) = static_tokens().write() {
        for t in tokens {
            guard.insert(static_token_key(&t.network, &t.symbol), t);
        }
    }
}

/// Snapshot of the static registry — handy for tests + audits.
pub fn list_registered_tokens() -> Vec<SupportedToken> {
    static_tokens()
        .read()
        .map(|g| g.values().cloned().collect())
        .unwrap_or_default()
}

/// Drop all entries from the static registry. Test-only escape hatch.
pub fn clear_registered_tokens() {
    if let Ok(mut guard) = static_tokens().write() {
        guard.clear();
    }
}

fn static_token_lookup(network: &str, symbol: &str) -> Option<SupportedToken> {
    static_tokens()
        .read()
        .ok()
        .and_then(|g| g.get(&static_token_key(network, symbol)).cloned())
}

pub struct AggregatorRegistry {
    http: HttpContext,
    public_key_override: Option<String>,
    public_key: RwLock<Option<String>>,
    tokens_by_network: RwLock<HashMap<String, Vec<SupportedToken>>>,
    /// Serializer for first-fetch paths so two concurrent callers don't
    /// each fire `/v2/pubkey` or `/v2/tokens?network=…`. The async
    /// mutex lets callers `await` the in-flight fetch without blocking
    /// the executor.
    fetch_lock: tokio::sync::Mutex<()>,
}

impl AggregatorRegistry {
    pub(crate) fn new(http: HttpContext, public_key_override: Option<String>) -> Self {
        Self {
            http,
            public_key_override,
            public_key: RwLock::new(None),
            tokens_by_network: RwLock::new(HashMap::new()),
            fetch_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub async fn get_public_key(&self) -> Result<String, PaycrestError> {
        if let Some(pem) = &self.public_key_override {
            return Ok(pem.clone());
        }
        // Fast path — already fetched.
        if let Ok(guard) = self.public_key.read() {
            if let Some(pem) = guard.as_ref() {
                return Ok(pem.clone());
            }
        }
        // Slow path — serialize concurrent first-fetches so we issue
        // exactly one `/pubkey` request even under contention.
        let _serialize = self.fetch_lock.lock().await;
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
        // Fast path — already fetched.
        if let Ok(guard) = self.tokens_by_network.read() {
            if let Some(cached) = guard.get(&slug) {
                return Ok(cached.clone());
            }
        }
        // Slow path — serialize concurrent first-fetches.
        let _serialize = self.fetch_lock.lock().await;
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
        // 1) Static registry — zero-RTT for hot tokens.
        if let Some(t) = static_token_lookup(network, symbol) {
            return Ok(t);
        }

        // 2) Live fetch (with in-memory cache).
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

    /// Pre-warm the in-memory cache for a network.
    pub async fn preload(&self, network: &str) -> Result<Vec<SupportedToken>, PaycrestError> {
        self.get_tokens_for_network(network).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::AggregatorRegistry;
    use crate::client::{HttpContext, RequestHooks, RetryPolicy};

    /// Spawn a counting HTTP fixture that always returns the canned
    /// token-list response, with a small delay so concurrent callers
    /// have time to overlap on the registry's slow path.
    async fn spawn_counting_tokens_server() -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().unwrap().port();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits_clone = Arc::clone(&hits);

        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let hits = Arc::clone(&hits_clone);
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = socket.read(&mut buf).await;
                    // Force overlap on the slow path.
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    hits.fetch_add(1, Ordering::SeqCst);

                    let body = br#"{"status":"success","message":"OK","data":[{"symbol":"USDT","contractAddress":"0xToken","decimals":6,"baseCurrency":"USD","network":"base"}]}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.write_all(body).await;
                    let _ = socket.shutdown().await;
                });
            }
        });

        (format!("http://127.0.0.1:{port}"), hits)
    }

    /// Concurrent first-fetch callers should share a single `/tokens`
    /// HTTP request. Without the registry's first-fetch serializer
    /// (the TOCTOU we fixed pre-2.1) this test would observe N hits
    /// for N concurrent callers, because each one would miss the
    /// `RwLock::read` cache before the first writer populated it.
    #[tokio::test]
    async fn concurrent_first_fetches_share_one_request() {
        let (base_url, hits) = spawn_counting_tokens_server().await;
        let http = HttpContext::new("", base_url, RetryPolicy::default(), RequestHooks::default());
        let registry = Arc::new(AggregatorRegistry::new(http, Some("PEM-OVERRIDE".to_string())));

        let mut handles = Vec::new();
        for _ in 0..16 {
            let registry = Arc::clone(&registry);
            handles.push(tokio::spawn(async move {
                registry.get_tokens_for_network("base").await
            }));
        }

        // All callers must succeed and observe the same row.
        for h in handles {
            let tokens = h.await.unwrap().expect("fetch ok");
            assert_eq!(tokens.len(), 1);
            assert_eq!(tokens[0].symbol, "USDT");
        }

        let observed = hits.load(Ordering::SeqCst);
        assert_eq!(
            observed, 1,
            "registry must serialize first-fetches; saw {observed} HTTP hits"
        );

        // Subsequent fetches stay cached — no new hits.
        let _ = registry.get_tokens_for_network("base").await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }
}
