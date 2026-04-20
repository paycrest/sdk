package sdk

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

type recordedRequest struct {
	Method string
	Path   string
	Query  map[string]string
	Body   map[string]interface{}
	APIKey string
}

type mockServer struct {
	t       *testing.T
	calls   []recordedRequest
	replies []func(rec recordedRequest) (int, map[string]interface{})
}

func newMockServer(t *testing.T, replies ...func(rec recordedRequest) (int, map[string]interface{})) (*mockServer, *httptest.Server) {
	t.Helper()
	ms := &mockServer{t: t, replies: replies}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := map[string]string{}
		for key := range r.URL.Query() {
			query[key] = r.URL.Query().Get(key)
		}

		body := map[string]interface{}{}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}

		rec := recordedRequest{
			Method: r.Method,
			Path:   r.URL.Path,
			Query:  query,
			Body:   body,
			APIKey: r.Header.Get("API-Key"),
		}
		ms.calls = append(ms.calls, rec)

		if len(ms.replies) == 0 {
			ms.t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}

		reply := ms.replies[0]
		ms.replies = ms.replies[1:]
		status, payload := reply(rec)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(payload)
	}))
	return ms, srv
}

func TestSenderOfframpFetchesSellRateBeforeOrder(t *testing.T) {
	ms, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			if !strings.HasPrefix(rec.Path, "/rates/base/USDT/100/NGN") {
				t.Fatalf("unexpected path for rate fetch: %s", rec.Path)
			}
			if rec.Query["side"] != "sell" {
				t.Fatalf("expected side=sell, got %q", rec.Query["side"])
			}
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"sell": map[string]interface{}{"rate": "1500"}}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			if rec.Path != "/sender/orders" {
				t.Fatalf("unexpected order path: %s", rec.Path)
			}
			if rec.Body["rate"] != "1500" {
				t.Fatalf("expected injected rate 1500, got %v", rec.Body["rate"])
			}
			return 201, map[string]interface{}{"status": "success", "data": map[string]interface{}{"id": "ord-1", "status": "initiated"}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "sender-key", BaseURL: srv.URL})
	sender, err := client.Sender()
	if err != nil {
		t.Fatalf("sender client init failed: %v", err)
	}

	_, err = sender.CreateOfframpOrder(context.Background(), map[string]interface{}{
		"amount": "100",
		"source": map[string]interface{}{"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
		"destination": map[string]interface{}{
			"type":     "fiat",
			"currency": "NGN",
			"recipient": map[string]interface{}{
				"institution":       "GTBINGLA",
				"accountIdentifier": "1234567890",
				"accountName":       "Jane",
				"memo":              "Payout",
			},
		},
	})
	if err != nil {
		t.Fatalf("create offramp failed: %v", err)
	}

	if len(ms.calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(ms.calls))
	}
}

func TestSenderOnrampFetchesBuyRateBeforeOrder(t *testing.T) {
	_, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			if rec.Query["side"] != "buy" {
				t.Fatalf("expected side=buy, got %q", rec.Query["side"])
			}
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"buy": map[string]interface{}{"rate": "1480"}}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			if rec.Body["rate"] != "1480" {
				t.Fatalf("expected injected rate 1480, got %v", rec.Body["rate"])
			}
			return 201, map[string]interface{}{"status": "success", "data": map[string]interface{}{"id": "ord-2", "status": "initiated"}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "sender-key", BaseURL: srv.URL})
	sender, _ := client.Sender()
	_, err := sender.CreateOnrampOrder(context.Background(), map[string]interface{}{
		"amount": "50000",
		"source": map[string]interface{}{
			"type":     "fiat",
			"currency": "NGN",
			"refundAccount": map[string]interface{}{
				"institution":       "GTBINGLA",
				"accountIdentifier": "1234567890",
				"accountName":       "Jane",
			},
		},
		"destination": map[string]interface{}{
			"type":      "crypto",
			"currency":  "USDT",
			"recipient": map[string]interface{}{"address": "0xabc", "network": "base"},
		},
	})
	if err != nil {
		t.Fatalf("create onramp failed: %v", err)
	}
}

func TestSenderManualRateSkipsQuote(t *testing.T) {
	ms, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			if rec.Path != "/sender/orders" {
				t.Fatalf("expected direct order create, got %s", rec.Path)
			}
			if rec.Body["rate"] != "1499" {
				t.Fatalf("expected provided rate, got %v", rec.Body["rate"])
			}
			return 201, map[string]interface{}{"status": "success", "data": map[string]interface{}{"id": "ord-3"}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "sender-key", BaseURL: srv.URL})
	sender, _ := client.Sender()
	_, err := sender.CreateOfframpOrder(context.Background(), map[string]interface{}{
		"amount": "100",
		"rate":   "1499",
		"source": map[string]interface{}{"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
		"destination": map[string]interface{}{
			"type":     "fiat",
			"currency": "NGN",
			"recipient": map[string]interface{}{
				"institution":       "GTBINGLA",
				"accountIdentifier": "1234567890",
				"accountName":       "Jane",
				"memo":              "Payout",
			},
		},
	})
	if err != nil {
		t.Fatalf("create with manual rate failed: %v", err)
	}

	if len(ms.calls) != 1 {
		t.Fatalf("expected one call, got %d", len(ms.calls))
	}
}

func TestSenderCreateOrderRoutesByDirection(t *testing.T) {
	ms, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"sell": map[string]interface{}{"rate": "1500"}}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 201, map[string]interface{}{"status": "success", "data": map[string]interface{}{"id": "off"}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"buy": map[string]interface{}{"rate": "1480"}}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 201, map[string]interface{}{"status": "success", "data": map[string]interface{}{"id": "on"}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "sender-key", BaseURL: srv.URL})
	sender, _ := client.Sender()

	_, err := sender.CreateOrder(context.Background(), map[string]interface{}{
		"amount": "100",
		"source": map[string]interface{}{"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
		"destination": map[string]interface{}{
			"type":     "fiat",
			"currency": "NGN",
			"recipient": map[string]interface{}{
				"institution":       "GTBINGLA",
				"accountIdentifier": "1234567890",
				"accountName":       "Jane",
				"memo":              "Payout",
			},
		},
	})
	if err != nil {
		t.Fatalf("offramp create order failed: %v", err)
	}

	_, err = sender.CreateOrder(context.Background(), map[string]interface{}{
		"amount": "50000",
		"source": map[string]interface{}{
			"type":     "fiat",
			"currency": "NGN",
			"refundAccount": map[string]interface{}{
				"institution":       "GTBINGLA",
				"accountIdentifier": "1234567890",
				"accountName":       "Jane",
			},
		},
		"destination": map[string]interface{}{
			"type":      "crypto",
			"currency":  "USDT",
			"recipient": map[string]interface{}{"address": "0xabc", "network": "base"},
		},
	})
	if err != nil {
		t.Fatalf("onramp create order failed: %v", err)
	}

	if len(ms.calls) < 3 {
		t.Fatalf("expected >=3 calls, got %d", len(ms.calls))
	}
	if ms.calls[0].Query["side"] != "sell" {
		t.Fatalf("expected first side sell, got %q", ms.calls[0].Query["side"])
	}
	if ms.calls[2].Query["side"] != "buy" {
		t.Fatalf("expected second side buy, got %q", ms.calls[2].Query["side"])
	}
}

func TestProviderEndpoints(t *testing.T) {
	ms, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"total": 0, "page": 1, "pageSize": 10, "orders": []interface{}{}}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"id": "ord-provider"}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"totalOrders": 1}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"nodeId": "node-1"}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"buy": map[string]interface{}{"marketRate": "1"}}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{ProviderAPIKey: "provider-key", BaseURL: srv.URL})
	provider, err := client.Provider()
	if err != nil {
		t.Fatalf("provider init failed: %v", err)
	}

	_, err = provider.ListOrders(context.Background(), ProviderListOrdersParams{Currency: "NGN", Page: 2, PageSize: 5, Status: "pending", Ordering: "desc"})
	if err != nil {
		t.Fatalf("list orders failed: %v", err)
	}
	_, _ = provider.GetOrder(context.Background(), "ord-provider")
	_, _ = provider.GetStats(context.Background(), "NGN")
	_, _ = provider.GetNodeInfo(context.Background())
	_, _ = provider.GetMarketRate(context.Background(), "USDT", "NGN")

	if len(ms.calls) != 5 {
		t.Fatalf("expected 5 provider calls, got %d", len(ms.calls))
	}
	if ms.calls[0].Path != "/provider/orders" || ms.calls[0].Query["currency"] != "NGN" {
		t.Fatalf("unexpected list orders call: %+v", ms.calls[0])
	}
}

func TestClientCredentialSeparation(t *testing.T) {
	ms, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			if rec.APIKey != "sender-key" {
				t.Fatalf("expected sender key, got %q", rec.APIKey)
			}
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"totalOrders": 1, "totalOrderVolume": "1", "totalFeeEarnings": "0"}}
		},
		func(rec recordedRequest) (int, map[string]interface{}) {
			if rec.APIKey != "provider-key" {
				t.Fatalf("expected provider key, got %q", rec.APIKey)
			}
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"totalOrders": 1, "totalFiatVolume": "1", "totalCryptoVolume": "1"}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "sender-key", ProviderAPIKey: "provider-key", BaseURL: srv.URL})
	sender, err := client.Sender()
	if err != nil {
		t.Fatalf("sender init failed: %v", err)
	}
	provider, err := client.Provider()
	if err != nil {
		t.Fatalf("provider init failed: %v", err)
	}

	_, _ = sender.GetStats(context.Background())
	_, _ = provider.GetStats(context.Background(), "")

	if len(ms.calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(ms.calls))
	}
}

func TestClientMissingCredentials(t *testing.T) {
	client := NewClientWithOptions(ClientOptions{BaseURL: "http://localhost"})

	if _, err := client.Sender(); err == nil || !strings.Contains(err.Error(), "sender api key") {
		t.Fatalf("expected sender credential error, got %v", err)
	}
	if _, err := client.Provider(); err == nil || !strings.Contains(err.Error(), "provider api key") {
		t.Fatalf("expected provider credential error, got %v", err)
	}
}

func TestSenderErrorMapping(t *testing.T) {
	_, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			return 400, map[string]interface{}{"status": "error", "message": "Validation failed", "data": []interface{}{map[string]interface{}{"field": "amount", "message": "required"}}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "sender-key", BaseURL: srv.URL})
	sender, _ := client.Sender()
	_, err := sender.GetStats(context.Background())
	if err == nil {
		t.Fatalf("expected error")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected APIError, got %T", err)
	}
	if apiErr.StatusCode != 400 || apiErr.Message != "Validation failed" {
		t.Fatalf("unexpected api error: %+v", apiErr)
	}
}

func TestProviderListOrdersDefaultsPageAndPageSize(t *testing.T) {
	ms, srv := newMockServer(t,
		func(rec recordedRequest) (int, map[string]interface{}) {
			page, _ := strconv.Atoi(rec.Query["page"])
			pageSize, _ := strconv.Atoi(rec.Query["pageSize"])
			if page != 1 || pageSize != 10 {
				t.Fatalf("expected defaults page=1 pageSize=10 got page=%d pageSize=%d", page, pageSize)
			}
			return 200, map[string]interface{}{"status": "success", "data": map[string]interface{}{"total": 0, "page": 1, "pageSize": 10, "orders": []interface{}{}}}
		},
	)
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{ProviderAPIKey: "provider-key", BaseURL: srv.URL})
	provider, _ := client.Provider()
	_, err := provider.ListOrders(context.Background(), ProviderListOrdersParams{Currency: "NGN"})
	if err != nil {
		t.Fatalf("list orders defaults failed: %v", err)
	}

	if len(ms.calls) != 1 {
		t.Fatalf("expected single call")
	}
}
