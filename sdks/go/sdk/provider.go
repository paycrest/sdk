package sdk

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
)

type ProviderService struct {
	http *httpClientConfig
}

type ProviderListOrdersParams struct {
	Currency string
	Page     int
	PageSize int
	Status   string
	Ordering string
	Search   string
	Export   string
	From     string
	To       string
}

func (p *ProviderService) ListOrders(ctx context.Context, params ProviderListOrdersParams) (*ListOrdersResponse, error) {
	page := params.Page
	if page == 0 {
		page = 1
	}
	pageSize := params.PageSize
	if pageSize == 0 {
		pageSize = 10
	}

	query := map[string]string{
		"currency": params.Currency,
		"page":     strconv.Itoa(page),
		"pageSize": strconv.Itoa(pageSize),
		"status":   params.Status,
		"ordering": params.Ordering,
		"search":   params.Search,
		"export":   params.Export,
		"from":     params.From,
		"to":       params.To,
	}

	var response APIResponse[ListOrdersResponse]
	if err := p.http.request(ctx, http.MethodGet, "/provider/orders", query, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (p *ProviderService) GetOrder(ctx context.Context, orderID string) (*PaymentOrder, error) {
	var response APIResponse[PaymentOrder]
	if err := p.http.request(ctx, http.MethodGet, "/provider/orders/"+orderID, nil, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (p *ProviderService) GetStats(ctx context.Context, currency string) (*ProviderStats, error) {
	query := map[string]string{"currency": currency}
	var response APIResponse[ProviderStats]
	if err := p.http.request(ctx, http.MethodGet, "/provider/stats", query, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (p *ProviderService) GetNodeInfo(ctx context.Context) (map[string]interface{}, error) {
	var response APIResponse[map[string]interface{}]
	if err := p.http.request(ctx, http.MethodGet, "/provider/node-info", nil, nil, &response); err != nil {
		return nil, err
	}
	return response.Data, nil
}

func (p *ProviderService) GetMarketRate(ctx context.Context, token, fiat string) (*MarketRateResponse, error) {
	path := fmt.Sprintf("/provider/rates/%s/%s", token, fiat)
	var response APIResponse[MarketRateResponse]
	if err := p.http.request(ctx, http.MethodGet, path, nil, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}
