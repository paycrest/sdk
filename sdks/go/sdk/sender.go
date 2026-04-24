package sdk

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// TerminalStatuses are order statuses after which no further state
// transition is expected.
var TerminalStatuses = map[string]struct{}{
	"settled":   {},
	"refunded":  {},
	"expired":   {},
	"cancelled": {},
}

// ListOrdersQuery is the typed filter for SenderService.ListOrdersQuery.
type ListOrdersQuery struct {
	Page     int
	PageSize int
	Status   string
}

// WaitForStatusOptions controls SenderService.WaitForStatus polling.
type WaitForStatusOptions struct {
	// PollInterval defaults to 3s when zero.
	PollInterval time.Duration
	// Timeout defaults to 5 minutes when zero.
	Timeout time.Duration
}

type SenderService struct {
	http       *httpClientConfig
	publicHTTP *httpClientConfig
	gateway    *gatewayClient
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

	return nil, &APIError{StatusCode: 400, Message: "invalid sender order direction", Kind: ErrValidation}
}

// CreateOfframpOrder posts the off-ramp order to the aggregator (API
// path). Kept for backwards compatibility with existing callers; prefer
// CreateOfframpOrderWithMethod for new integrations.
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

// CreateOfframpOrderWithMethod dispatches an off-ramp order through the
// aggregator API (method="api", default) or directly to the on-chain
// Gateway contract (method="gateway"). Returns a union result that
// surfaces exactly one of Payment (API) or Gateway (on-chain) based on
// the selected dispatch method.
func (s *SenderService) CreateOfframpOrderWithMethod(
	ctx context.Context,
	payload OfframpOrderPayload,
	opts CreateOfframpOptions,
) (*OfframpOrderResult, error) {
	method := opts.Method
	if method == "" {
		method = OfframpMethodAPI
	}
	if method == OfframpMethodGateway {
		if s.gateway == nil {
			return nil, &APIError{StatusCode: 400, Kind: ErrValidation, Message: "gateway dispatch is not configured; pass ClientOptions.Gateway when constructing the client"}
		}
		result, err := s.gateway.createOfframpOrder(ctx, payload, s.resolveRateForGateway)
		if err != nil {
			return nil, err
		}
		return &OfframpOrderResult{Method: OfframpMethodGateway, Gateway: result}, nil
	}

	payment, err := s.CreateOfframpOrder(ctx, payload.MarshalMap())
	if err != nil {
		return nil, err
	}
	return &OfframpOrderResult{Method: OfframpMethodAPI, Payment: payment}, nil
}

func (s *SenderService) resolveRateForGateway(ctx context.Context, network, token, amount, fiat string) (string, error) {
	var response APIResponse[RateQuoteResponse]
	path := fmt.Sprintf("/rates/%s/%s/%s/%s", network, token, amount, fiat)
	if err := s.publicHTTP.request(ctx, http.MethodGet, path, map[string]string{"side": "sell"}, nil, &response); err != nil {
		return "", err
	}
	if response.Data.Sell == nil || response.Data.Sell.Rate == "" {
		return "", &APIError{StatusCode: 404, Kind: ErrRateQuoteUnavailable, Message: "aggregator returned no sell-side rate"}
	}
	return response.Data.Sell.Rate, nil
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

// ListOrders lists sender orders using untyped parameters. Kept for
// backwards compatibility; prefer ListOrdersQuery for new integrations.
func (s *SenderService) ListOrders(ctx context.Context, page, pageSize int, status string) (*ListOrdersResponse, error) {
	return s.ListOrdersQuery(ctx, ListOrdersQuery{Page: page, PageSize: pageSize, Status: status})
}

// ListOrdersQuery lists sender orders using a typed filter.
func (s *SenderService) ListOrdersQuery(ctx context.Context, q ListOrdersQuery) (*ListOrdersResponse, error) {
	page := q.Page
	if page == 0 {
		page = 1
	}
	pageSize := q.PageSize
	if pageSize == 0 {
		pageSize = 10
	}
	query := map[string]string{
		"page":     strconv.Itoa(page),
		"pageSize": strconv.Itoa(pageSize),
		"status":   q.Status,
	}

	var response APIResponse[ListOrdersResponse]
	if err := s.http.request(ctx, http.MethodGet, "/sender/orders", query, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

// WaitForStatus polls GetOrder until the order reaches target or the
// timeout expires. `target` may be a specific status, a comma-separated
// list of statuses, or the literal "terminal" (any of settled /
// refunded / expired / cancelled).
func (s *SenderService) WaitForStatus(
	ctx context.Context,
	orderID, target string,
	opts WaitForStatusOptions,
) (*PaymentOrder, error) {
	pollInterval := opts.PollInterval
	if pollInterval <= 0 {
		pollInterval = 3 * time.Second
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	deadline := time.Now().Add(timeout)

	var last *PaymentOrder
	for {
		order, err := s.GetOrder(ctx, orderID)
		if err != nil {
			return nil, err
		}
		last = order
		if matchesWaitTarget(order.Status, target) {
			return order, nil
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return last, &APIError{
				StatusCode: 408,
				Kind:       ErrUnspecified,
				Message:    fmt.Sprintf("timed out waiting for order %s to reach %s; last status=%s", orderID, target, order.Status),
				Details:    last,
			}
		}
		wait := pollInterval
		if wait > remaining {
			wait = remaining
		}
		select {
		case <-ctx.Done():
			return last, ctx.Err()
		case <-time.After(wait):
		}
	}
}

func matchesWaitTarget(status, target string) bool {
	if target == "terminal" {
		_, ok := TerminalStatuses[status]
		return ok
	}
	// Support comma-separated lists so callers can pass "settled,refunded".
	for _, s := range splitCommas(target) {
		if s == status {
			return true
		}
	}
	return false
}

func splitCommas(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return append(out, s[start:])
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
		return nil, &APIError{StatusCode: 404, Kind: ErrRateQuoteUnavailable, Message: "unable to resolve rate for requested order"}
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
