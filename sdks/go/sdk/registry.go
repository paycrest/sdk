package sdk

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// SupportedToken mirrors `GET /v2/tokens?network=<slug>` response rows.
type SupportedToken struct {
	Symbol          string `json:"symbol"`
	ContractAddress string `json:"contractAddress"`
	Decimals        int    `json:"decimals"`
	BaseCurrency    string `json:"baseCurrency"`
	Network         string `json:"network"`
}

// aggregatorRegistry caches the aggregator's public key and per-network
// token catalog in-memory for the process lifetime.
type aggregatorRegistry struct {
	http             *httpClientConfig
	publicKeyMu      sync.RWMutex
	publicKey        string
	publicKeyOverride string
	tokensMu         sync.RWMutex
	tokensByNetwork  map[string][]SupportedToken
}

func newAggregatorRegistry(http *httpClientConfig, publicKeyOverride string) *aggregatorRegistry {
	return &aggregatorRegistry{
		http:              http,
		publicKeyOverride: publicKeyOverride,
		tokensByNetwork:   map[string][]SupportedToken{},
	}
}

func (r *aggregatorRegistry) getPublicKey(ctx context.Context) (string, error) {
	if r.publicKeyOverride != "" {
		return r.publicKeyOverride, nil
	}
	r.publicKeyMu.RLock()
	cached := r.publicKey
	r.publicKeyMu.RUnlock()
	if cached != "" {
		return cached, nil
	}

	var response APIResponse[string]
	if err := r.http.request(ctx, http.MethodGet, "/pubkey", nil, nil, &response); err != nil {
		return "", err
	}
	if response.Data == "" {
		return "", fmt.Errorf("aggregator /pubkey returned no PEM data")
	}

	r.publicKeyMu.Lock()
	r.publicKey = response.Data
	r.publicKeyMu.Unlock()
	return response.Data, nil
}

func (r *aggregatorRegistry) getTokensForNetwork(ctx context.Context, network string) ([]SupportedToken, error) {
	slug := strings.ToLower(network)
	r.tokensMu.RLock()
	cached, ok := r.tokensByNetwork[slug]
	r.tokensMu.RUnlock()
	if ok {
		return cached, nil
	}

	var response APIResponse[[]SupportedToken]
	if err := r.http.request(ctx, http.MethodGet, "/tokens", map[string]string{"network": slug}, nil, &response); err != nil {
		return nil, err
	}

	r.tokensMu.Lock()
	r.tokensByNetwork[slug] = response.Data
	r.tokensMu.Unlock()
	return response.Data, nil
}

func (r *aggregatorRegistry) getToken(ctx context.Context, network, symbol string) (SupportedToken, error) {
	tokens, err := r.getTokensForNetwork(ctx, network)
	if err != nil {
		return SupportedToken{}, err
	}
	want := strings.ToUpper(symbol)
	for _, t := range tokens {
		if strings.ToUpper(t.Symbol) == want {
			return t, nil
		}
	}
	known := make([]string, 0, len(tokens))
	for _, t := range tokens {
		known = append(known, t.Symbol)
	}
	return SupportedToken{}, fmt.Errorf("token %q is not enabled on network %q; known: %v", symbol, network, known)
}
