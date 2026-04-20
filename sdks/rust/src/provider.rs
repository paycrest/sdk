use reqwest::Method;

use crate::client::{ClientHttp, RequestExecutor};
use crate::error::PaycrestError;
use crate::models::{ListOrdersResponse, MarketRateResponse, PaymentOrder, ProviderStats};

#[derive(Clone)]
pub struct ProviderClient {
    http: ClientHttp,
}

impl ProviderClient {
    pub(crate) fn new(http: ClientHttp) -> Self {
        Self { http }
    }

    pub async fn list_orders(
        &self,
        params: ProviderListOrdersParams,
    ) -> Result<ListOrdersResponse, PaycrestError> {
        let mut query = vec![
            ("currency", params.currency),
            ("page", params.page.to_string()),
            ("pageSize", params.page_size.to_string()),
        ];

        if let Some(status) = params.status {
            query.push(("status", status));
        }
        if let Some(ordering) = params.ordering {
            query.push(("ordering", ordering));
        }
        if let Some(search) = params.search {
            query.push(("search", search));
        }
        if let Some(export) = params.export {
            query.push(("export", export));
        }
        if let Some(from) = params.from {
            query.push(("from", from));
        }
        if let Some(to) = params.to {
            query.push(("to", to));
        }

        let response = self
            .http
            .request(
                Method::GET,
                "/provider/orders".to_string(),
                Some(query),
                None,
            )
            .await?;
        Ok(response.data)
    }

    pub async fn get_order(&self, order_id: &str) -> Result<PaymentOrder, PaycrestError> {
        let path = format!("/provider/orders/{order_id}");
        let response = self.http.request(Method::GET, path, None, None).await?;
        Ok(response.data)
    }

    pub async fn get_stats(&self, currency: Option<&str>) -> Result<ProviderStats, PaycrestError> {
        let query = currency.map(|c| vec![("currency", c.to_string())]);
        let response = self
            .http
            .request(Method::GET, "/provider/stats".to_string(), query, None)
            .await?;
        Ok(response.data)
    }

    pub async fn get_node_info(&self) -> Result<serde_json::Value, PaycrestError> {
        let response = self
            .http
            .request(Method::GET, "/provider/node-info".to_string(), None, None)
            .await?;
        Ok(response.data)
    }

    pub async fn get_market_rate(
        &self,
        token: &str,
        fiat: &str,
    ) -> Result<MarketRateResponse, PaycrestError> {
        let path = format!("/provider/rates/{token}/{fiat}");
        let response = self.http.request(Method::GET, path, None, None).await?;
        Ok(response.data)
    }
}

pub struct ProviderListOrdersParams {
    pub currency: String,
    pub page: i64,
    pub page_size: i64,
    pub status: Option<String>,
    pub ordering: Option<String>,
    pub search: Option<String>,
    pub export: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

impl ProviderListOrdersParams {
    pub fn new(currency: impl Into<String>) -> Self {
        Self {
            currency: currency.into(),
            page: 1,
            page_size: 10,
            status: None,
            ordering: None,
            search: None,
            export: None,
            from: None,
            to: None,
        }
    }
}
