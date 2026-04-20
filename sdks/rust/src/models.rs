use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiResponse<T> {
    pub status: String,
    pub message: Option<String>,
    pub data: T,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SenderStats {
    #[serde(rename = "totalOrders")]
    pub total_orders: i64,
    #[serde(rename = "totalOrderVolume")]
    pub total_order_volume: String,
    #[serde(rename = "totalFeeEarnings")]
    pub total_fee_earnings: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderStats {
    #[serde(rename = "totalOrders")]
    pub total_orders: i64,
    #[serde(rename = "totalFiatVolume")]
    pub total_fiat_volume: String,
    #[serde(rename = "totalCryptoVolume")]
    pub total_crypto_volume: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PaymentOrder {
    pub id: String,
    pub status: String,
    pub direction: Option<String>,
    #[serde(rename = "orderType")]
    pub order_type: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    pub amount: Option<String>,
    #[serde(rename = "amountInUsd")]
    pub amount_in_usd: Option<String>,
    #[serde(rename = "amountPaid")]
    pub amount_paid: Option<String>,
    #[serde(rename = "amountReturned")]
    pub amount_returned: Option<String>,
    #[serde(rename = "percentSettled")]
    pub percent_settled: Option<String>,
    pub rate: Option<String>,
    #[serde(rename = "senderFee")]
    pub sender_fee: Option<String>,
    #[serde(rename = "senderFeePercent")]
    pub sender_fee_percent: Option<String>,
    #[serde(rename = "transactionFee")]
    pub transaction_fee: Option<String>,
    pub reference: Option<String>,
    #[serde(rename = "txHash")]
    pub tx_hash: Option<String>,
    #[serde(rename = "providerAccount")]
    pub provider_account: Option<Value>,
    pub source: Option<Value>,
    pub destination: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ListOrdersResponse {
    pub total: i64,
    pub page: i64,
    #[serde(rename = "pageSize")]
    pub page_size: i64,
    pub orders: Vec<PaymentOrder>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RateQuoteSide {
    pub rate: String,
    #[serde(rename = "providerIds")]
    pub provider_ids: Vec<String>,
    #[serde(rename = "orderType")]
    pub order_type: String,
    #[serde(rename = "refundTimeoutMinutes")]
    pub refund_timeout_minutes: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RateQuoteResponse {
    pub buy: Option<RateQuoteSide>,
    pub sell: Option<RateQuoteSide>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MarketRateSide {
    #[serde(rename = "marketRate")]
    pub market_rate: String,
    #[serde(rename = "minimumRate")]
    pub minimum_rate: String,
    #[serde(rename = "maximumRate")]
    pub maximum_rate: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MarketRateResponse {
    pub buy: Option<MarketRateSide>,
    pub sell: Option<MarketRateSide>,
}
