package sdk

type APIResponse[T any] struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

type VerifyAccountRequest struct {
	Institution       string `json:"institution"`
	AccountIdentifier string `json:"accountIdentifier"`
}

type SenderStats struct {
	TotalOrders      int    `json:"totalOrders"`
	TotalOrderVolume string `json:"totalOrderVolume"`
	TotalFeeEarnings string `json:"totalFeeEarnings"`
}

type ProviderStats struct {
	TotalOrders       int    `json:"totalOrders"`
	TotalFiatVolume   string `json:"totalFiatVolume"`
	TotalCryptoVolume string `json:"totalCryptoVolume"`
}

type PaymentOrder struct {
	ID              string                 `json:"id"`
	Status          string                 `json:"status"`
	Direction       string                 `json:"direction,omitempty"`
	OrderType       string                 `json:"orderType,omitempty"`
	CreatedAt       string                 `json:"createdAt,omitempty"`
	UpdatedAt       string                 `json:"updatedAt,omitempty"`
	Amount          string                 `json:"amount,omitempty"`
	AmountInUSD     string                 `json:"amountInUsd,omitempty"`
	AmountPaid      string                 `json:"amountPaid,omitempty"`
	AmountReturned  string                 `json:"amountReturned,omitempty"`
	PercentSettled  string                 `json:"percentSettled,omitempty"`
	Rate            string                 `json:"rate,omitempty"`
	SenderFee       string                 `json:"senderFee,omitempty"`
	SenderFeePct    string                 `json:"senderFeePercent,omitempty"`
	TransactionFee  string                 `json:"transactionFee,omitempty"`
	Reference       string                 `json:"reference,omitempty"`
	TxHash          string                 `json:"txHash,omitempty"`
	ProviderAccount map[string]interface{} `json:"providerAccount,omitempty"`
	Source          map[string]interface{} `json:"source,omitempty"`
	Destination     map[string]interface{} `json:"destination,omitempty"`
}

type ListOrdersResponse struct {
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Orders   []PaymentOrder `json:"orders"`
}

type RateQuoteSide struct {
	Rate                 string   `json:"rate"`
	ProviderIDs          []string `json:"providerIds"`
	OrderType            string   `json:"orderType"`
	RefundTimeoutMinutes int      `json:"refundTimeoutMinutes"`
}

type RateQuoteResponse struct {
	Buy  *RateQuoteSide `json:"buy,omitempty"`
	Sell *RateQuoteSide `json:"sell,omitempty"`
}

type MarketRateSide struct {
	MarketRate  string `json:"marketRate"`
	MinimumRate string `json:"minimumRate"`
	MaximumRate string `json:"maximumRate"`
}

type MarketRateResponse struct {
	Buy  *MarketRateSide `json:"buy,omitempty"`
	Sell *MarketRateSide `json:"sell,omitempty"`
}
