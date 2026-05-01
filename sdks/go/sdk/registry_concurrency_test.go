package sdk

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestRegistrySerializesConcurrentTokenFetches verifies that N
// concurrent first-fetch callers share a single underlying
// `/v2/tokens` HTTP request — i.e. the RLock→drop→Lock TOCTOU window
// is closed by `fetchMu`.
//
// Without the fix this test fails with hits == N: each goroutine
// would miss the read-lock cache before the first writer populated
// it, then each independently fires the fetch.
func TestRegistrySerializesConcurrentTokenFetches(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		// Force overlap on the slow path so concurrent callers race
		// on the cache miss instead of finishing serially.
		time.Sleep(50 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data": []map[string]interface{}{{
				"symbol":          "USDT",
				"contractAddress": "0xToken",
				"decimals":        6,
				"baseCurrency":    "USD",
				"network":         "base",
			}},
		})
	}))
	defer srv.Close()

	cfg := newHTTPConfig("", srv.URL, 5*time.Second, DefaultRetryPolicy, RequestHooks{})
	registry := newAggregatorRegistry(cfg, "")

	const N = 16
	var wg sync.WaitGroup
	results := make(chan error, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tokens, err := registry.getTokensForNetwork(context.Background(), "base")
			if err != nil {
				results <- err
				return
			}
			if len(tokens) != 1 || tokens[0].Symbol != "USDT" {
				results <- &APIError{Message: "unexpected token shape"}
				return
			}
			results <- nil
		}()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatalf("concurrent caller failed: %v", err)
		}
	}

	got := atomic.LoadInt32(&hits)
	if got != 1 {
		t.Fatalf("registry must serialize first-fetches; saw %d HTTP hits, want 1", got)
	}

	// Subsequent fetches stay cached — no new hits.
	if _, err := registry.getTokensForNetwork(context.Background(), "base"); err != nil {
		t.Fatalf("post-cache fetch failed: %v", err)
	}
	if final := atomic.LoadInt32(&hits); final != 1 {
		t.Fatalf("cache must satisfy subsequent reads; saw %d hits after cache", final)
	}
}

// TestRegistrySerializesConcurrentPubkeyFetches mirrors the test above
// for `/v2/pubkey`. The same RLock→drop→Lock pattern lived in
// getPublicKey before the fix.
func TestRegistrySerializesConcurrentPubkeyFetches(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		time.Sleep(50 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data":   "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----\n",
		})
	}))
	defer srv.Close()

	cfg := newHTTPConfig("", srv.URL, 5*time.Second, DefaultRetryPolicy, RequestHooks{})
	registry := newAggregatorRegistry(cfg, "")

	const N = 16
	var wg sync.WaitGroup
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = registry.getPublicKey(context.Background())
		}()
	}
	wg.Wait()

	got := atomic.LoadInt32(&hits)
	if got != 1 {
		t.Fatalf("registry must serialize first-fetches; saw %d /pubkey hits, want 1", got)
	}
}
