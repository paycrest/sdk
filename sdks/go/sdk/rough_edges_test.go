package sdk

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClassifyHTTPErrorPopulatesFieldErrors(t *testing.T) {
	details := []interface{}{
		map[string]interface{}{"field": "amount", "message": "required"},
		map[string]interface{}{"field": "source.currency", "message": "unknown token"},
		"ignored-string-entry",
	}
	err := classifyHTTPError(400, "Validation failed", details, 0)
	if err.Kind != ErrValidation {
		t.Fatalf("expected ErrValidation, got %v", err.Kind)
	}
	if len(err.FieldErrors) != 2 {
		t.Fatalf("expected 2 field errors, got %d: %+v", len(err.FieldErrors), err.FieldErrors)
	}
	if err.FieldErrors[0].Field != "amount" || err.FieldErrors[0].Message != "required" {
		t.Fatalf("unexpected first field error: %+v", err.FieldErrors[0])
	}
	if err.FieldErrors[1].Field != "source.currency" {
		t.Fatalf("unexpected second field error: %+v", err.FieldErrors[1])
	}
}

func TestClassifyHTTPError(t *testing.T) {
	cases := []struct {
		status int
		want   ErrorKind
	}{
		{400, ErrValidation},
		{401, ErrAuthentication},
		{403, ErrAuthentication},
		{404, ErrNotFound},
		{429, ErrRateLimit},
		{503, ErrProviderUnavailable},
		{500, ErrUnspecified},
	}
	for _, tc := range cases {
		err := classifyHTTPError(tc.status, "x", nil, 0)
		if err.Kind != tc.want {
			t.Fatalf("status %d: got kind %v, want %v", tc.status, err.Kind, tc.want)
		}
	}

	err := classifyHTTPError(429, "slow down", nil, 2.5)
	if err.RetryAfterSeconds != 2.5 {
		t.Fatalf("expected retry-after 2.5, got %v", err.RetryAfterSeconds)
	}
}

func TestErrorsIsMatchesKind(t *testing.T) {
	err := classifyHTTPError(404, "missing", nil, 0)
	if !errors.Is(err, ErrNotFound) {
		t.Fatal("errors.Is should match ErrNotFound")
	}
	if errors.Is(err, ErrValidation) {
		t.Fatal("errors.Is should not match unrelated kind")
	}
}

func TestGETRetriesOn5xxAndSucceeds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&calls, 1)
		if count < 2 {
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"message": "transient"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"totalOrders": 3},
		})
	}))
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{
		SenderAPIKey: "k",
		BaseURL:      srv.URL,
		RetryPolicy:  RetryPolicy{Retries: 3, BaseDelay: 1 * time.Millisecond, MaxDelay: 10 * time.Millisecond},
	})
	sender, _ := client.Sender()
	stats, err := sender.GetStats(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.TotalOrders != 3 {
		t.Fatalf("unexpected totalOrders: %d", stats.TotalOrders)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("expected 2 attempts, got %d", calls)
	}
}

func TestPOSTDoesNotRetryOn5xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"message": "overloaded"})
	}))
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{
		SenderAPIKey: "k",
		BaseURL:      srv.URL,
		RetryPolicy:  RetryPolicy{Retries: 3, BaseDelay: 1 * time.Millisecond, MaxDelay: 10 * time.Millisecond},
	})
	sender, _ := client.Sender()
	_, err := sender.VerifyAccount(context.Background(), "GTBINGLA", "1234567890")
	if err == nil {
		t.Fatal("expected error")
	}
	var api *APIError
	if !errors.As(err, &api) || api.Kind != ErrProviderUnavailable {
		t.Fatalf("expected ErrProviderUnavailable, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("POST should not auto-retry on 5xx; attempts=%d", calls)
	}
}

func TestWaitForStatusReachesTarget(t *testing.T) {
	statuses := []string{"pending", "fulfilling", "settled"}
	var idx int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := atomic.AddInt32(&idx, 1) - 1
		if int(i) >= len(statuses) {
			i = int32(len(statuses) - 1)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"id": "ord", "status": statuses[i]},
		})
	}))
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "k", BaseURL: srv.URL})
	sender, _ := client.Sender()
	order, err := sender.WaitForStatus(context.Background(), "ord", "settled", WaitForStatusOptions{
		PollInterval: 1 * time.Millisecond,
		Timeout:      2 * time.Second,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if order.Status != "settled" {
		t.Fatalf("expected settled, got %s", order.Status)
	}
}

func TestWaitForStatusTerminalAliasAndTimeout(t *testing.T) {
	// Terminal match on "expired".
	expiredSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"id": "ord", "status": "expired"},
		})
	}))
	defer expiredSrv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "k", BaseURL: expiredSrv.URL})
	sender, _ := client.Sender()
	order, err := sender.WaitForStatus(context.Background(), "ord", "terminal", WaitForStatusOptions{
		PollInterval: 1 * time.Millisecond,
		Timeout:      500 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if order.Status != "expired" {
		t.Fatalf("expected expired, got %s", order.Status)
	}

	// Timeout on pending.
	stuckSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"id": "ord", "status": "pending"},
		})
	}))
	defer stuckSrv.Close()

	stuckClient := NewClientWithOptions(ClientOptions{SenderAPIKey: "k", BaseURL: stuckSrv.URL})
	stuck, _ := stuckClient.Sender()
	_, err = stuck.WaitForStatus(context.Background(), "ord", "settled", WaitForStatusOptions{
		PollInterval: 1 * time.Millisecond,
		Timeout:      20 * time.Millisecond,
	})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	var api *APIError
	if !errors.As(err, &api) || api.StatusCode != 408 {
		t.Fatalf("expected 408 timeout, got %v", err)
	}
}

func TestHooksObserveRequestsAndErrors(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&calls, 1)
		if count == 1 {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "success",
				"data":   map[string]interface{}{"totalOrders": 7},
			})
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"message": "nope"})
	}))
	defer srv.Close()

	var events []string
	client := NewClientWithOptions(ClientOptions{
		SenderAPIKey: "k",
		BaseURL:      srv.URL,
		Hooks: RequestHooks{
			OnRequest:  func(ctx HookContext) { events = append(events, "req:"+ctx.Method) },
			OnResponse: func(ctx HookContext) { events = append(events, "res:200") },
			OnError:    func(ctx HookContext) { events = append(events, "err") },
		},
	})
	sender, _ := client.Sender()
	if _, err := sender.GetStats(context.Background()); err != nil {
		t.Fatalf("first call failed: %v", err)
	}
	if _, err := sender.GetStats(context.Background()); err == nil {
		t.Fatal("expected second call to fail")
	}
	if len(events) < 4 {
		t.Fatalf("expected at least 4 hook events, got %v", events)
	}
	if events[0] != "req:GET" || events[1] != "res:200" {
		t.Fatalf("unexpected first pair: %v", events[:2])
	}
	if events[2] != "req:GET" || events[3] != "err" {
		t.Fatalf("unexpected second pair: %v", events[2:4])
	}
}

func TestForEachOrderWalksPages(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		page := r.URL.Query().Get("page")
		switch page {
		case "1":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"total": 3, "page": 1, "pageSize": 2,
					"orders": []map[string]interface{}{
						{"id": "a", "status": "settled"},
						{"id": "b", "status": "settled"},
					},
				},
			})
		case "2":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"total": 3, "page": 2, "pageSize": 2,
					"orders": []map[string]interface{}{
						{"id": "c", "status": "refunded"},
					},
				},
			})
		default:
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"total": 3, "page": 3, "pageSize": 2, "orders": []map[string]interface{}{},
				},
			})
		}
	}))
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "k", BaseURL: srv.URL})
	sender, _ := client.Sender()
	var ids []string
	err := sender.ForEachOrder(context.Background(), ListOrdersQuery{PageSize: 2}, func(order PaymentOrder) error {
		ids = append(ids, order.ID)
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ids) != 3 || ids[0] != "a" || ids[2] != "c" {
		t.Fatalf("unexpected ids: %v", ids)
	}
}

func TestListOrdersTypedQuery(t *testing.T) {
	var received map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = map[string]string{}
		for k := range r.URL.Query() {
			received[k] = r.URL.Query().Get(k)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"orders": []interface{}{}},
		})
	}))
	defer srv.Close()

	client := NewClientWithOptions(ClientOptions{SenderAPIKey: "k", BaseURL: srv.URL})
	sender, _ := client.Sender()
	if _, err := sender.ListOrdersQuery(context.Background(), ListOrdersQuery{Page: 2, PageSize: 50, Status: "settled"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["page"] != "2" || received["pageSize"] != "50" || received["status"] != "settled" {
		t.Fatalf("unexpected query params: %#v", received)
	}
}
