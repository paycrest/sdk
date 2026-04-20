package sdk

import (
	"context"
	"net/http"
	"strconv"
)

type SenderService struct {
	client *Client
}

func (s *SenderService) CreateOrder(ctx context.Context, payload map[string]interface{}) (*PaymentOrder, error) {
	var response APIResponse[PaymentOrder]
	if err := s.client.request(ctx, http.MethodPost, "/sender/orders", nil, payload, &response); err != nil {
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
	if err := s.client.request(ctx, http.MethodGet, "/sender/orders", query, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) GetOrder(ctx context.Context, orderID string) (*PaymentOrder, error) {
	var response APIResponse[PaymentOrder]
	if err := s.client.request(ctx, http.MethodGet, "/sender/orders/"+orderID, nil, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) GetStats(ctx context.Context) (*SenderStats, error) {
	var response APIResponse[SenderStats]
	if err := s.client.request(ctx, http.MethodGet, "/sender/stats", nil, nil, &response); err != nil {
		return nil, err
	}
	return &response.Data, nil
}

func (s *SenderService) VerifyAccount(ctx context.Context, institution, accountIdentifier string) (string, error) {
	payload := VerifyAccountRequest{Institution: institution, AccountIdentifier: accountIdentifier}
	var response APIResponse[string]
	if err := s.client.request(ctx, http.MethodPost, "/verify-account", nil, payload, &response); err != nil {
		return "", err
	}
	return response.Data, nil
}
