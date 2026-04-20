package sdk

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
)

type SenderService struct {
	http *httpClientConfig
}

func (s *SenderService) CreateOrder(ctx context.Context, payload map[string]interface{}) (*PaymentOrder, error) {
	sourceType := nestedString(payload, "source", "type")
	destinationType := nestedString(payload, "destination", "type")

	if sourceType == "crypto" && destinationType == "fiat" {
		return s.CreateOfframpOrder(ctx, payload)
	}
	if sourceType == "fiat" && destinationType == "crypto" {
		return s.CreateOnrampOrder(ctx, payload)
	}

	return nil, &APIError{StatusCode: 400, Message: "invalid sender order direction"}
}

func (s *SenderService) CreateOfframpOrder(ctx context.Context, payload map[string]interface{}) (*PaymentOrder, error) {
	prepared, err := s.withResolvedRate(ctx, payload, rateInput{
		Network: nestedString(payload, "source", "network"),
		Token:   nestedString(payload, "source", "currency"),
		Amount:  stringValue(payload["amount"]),
		Fiat:    nestedString(payload, "destination", "currency"),
		Side:    "sell",
	})
	if err != nil {
		return nil, err
	}

	var response APIResponse[PaymentOrder]
	if err := s.http.request(ctx, http.MethodPost, "/sender/orders", nil, prepared, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) CreateOnrampOrder(ctx context.Context, payload map[string]interface{}) (*PaymentOrder, error) {
	prepared, err := s.withResolvedRate(ctx, payload, rateInput{
		Network: nestedString(payload, "destination", "recipient", "network"),
		Token:   nestedString(payload, "destination", "currency"),
		Amount:  stringValue(payload["amount"]),
		Fiat:    nestedString(payload, "source", "currency"),
		Side:    "buy",
	})
	if err != nil {
		return nil, err
	}

	var response APIResponse[PaymentOrder]
	if err := s.http.request(ctx, http.MethodPost, "/sender/orders", nil, prepared, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) ListOrders(ctx context.Context, page, pageSize int, status string) (*ListOrdersResponse, error) {
	query := map[string]string{
		"page":     strconv.Itoa(page),
		"pageSize": strconv.Itoa(pageSize),
		"status":   status,
	}

	var response APIResponse[ListOrdersResponse]
	if err := s.http.request(ctx, http.MethodGet, "/sender/orders", query, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) GetOrder(ctx context.Context, orderID string) (*PaymentOrder, error) {
	var response APIResponse[PaymentOrder]
	if err := s.http.request(ctx, http.MethodGet, "/sender/orders/"+orderID, nil, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) GetStats(ctx context.Context) (*SenderStats, error) {
	var response APIResponse[SenderStats]
	if err := s.http.request(ctx, http.MethodGet, "/sender/stats", nil, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) VerifyAccount(ctx context.Context, institution, accountIdentifier string) (string, error) {
	payload := VerifyAccountRequest{Institution: institution, AccountIdentifier: accountIdentifier}
	var response APIResponse[string]
	if err := s.http.request(ctx, http.MethodPost, "/verify-account", nil, payload, &response); err != nil {
		return "", err
	}
	return response.Data, nil
}

func (s *SenderService) GetTokenRate(
	ctx context.Context,
	network,
	token,
	amount,
	fiat,
	side,
	providerID string,
) (*RateQuoteResponse, error) {
	query := map[string]string{"side": side, "provider_id": providerID}

	var response APIResponse[RateQuoteResponse]
	path := fmt.Sprintf("/rates/%s/%s/%s/%s", network, token, amount, fiat)
	if err := s.http.request(ctx, http.MethodGet, path, query, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

type rateInput struct {
	Network string
	Token   string
	Amount  string
	Fiat    string
	Side    string
}

func (s *SenderService) withResolvedRate(ctx context.Context, payload map[string]interface{}, input rateInput) (map[string]interface{}, error) {
	if stringValue(payload["rate"]) != "" {
		return payload, nil
	}

	quote, err := s.GetTokenRate(ctx, input.Network, input.Token, input.Amount, input.Fiat, input.Side, "")
	if err != nil {
		return nil, err
	}

	var rate string
	if input.Side == "buy" && quote.Buy != nil {
		rate = quote.Buy.Rate
	}
	if input.Side == "sell" && quote.Sell != nil {
		rate = quote.Sell.Rate
	}

	if rate == "" {
		return nil, &APIError{StatusCode: 404, Message: "unable to resolve rate for requested order"}
	}

	prepared := cloneMap(payload)
	prepared["rate"] = rate
	return prepared, nil
}

func cloneMap(src map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func nestedString(payload map[string]interface{}, path ...string) string {
	current := payload
	for i, p := range path {
		value, ok := current[p]
		if !ok {
			return ""
		}
		if i == len(path)-1 {
			return stringValue(value)
		}
		next, ok := value.(map[string]interface{})
		if !ok {
			return ""
		}
		current = next
	}
	return ""
}

func stringValue(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}
