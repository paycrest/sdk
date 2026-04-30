package sdk

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	mrand "math/rand"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const DefaultBaseURL = "https://api.paycrest.io/v2"

// RetryPolicy controls HTTP-level retries. GETs retry on transport
// errors + 408/429/500/502/503/504. POSTs retry **only** on transport
// errors that happened before the server acknowledged the request —
// acknowledged POST failures aren't auto-retried because they can
// double-submit payments.
type RetryPolicy struct {
	Retries     int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

var DefaultRetryPolicy = RetryPolicy{
	Retries:   3,
	BaseDelay: 500 * time.Millisecond,
	MaxDelay:  10 * time.Second,
}

// HookContext is the shape handed to every observation hook.
type HookContext struct {
	Method         string
	URL            string
	Attempt        int
	IdempotencyKey string
	StatusCode     int
	Duration       time.Duration
	Err            error
}

// RequestHooks lets integrators plug in structured logging, metrics,
// or OpenTelemetry tracing. Each hook is passive — panics are recovered
// so a faulty tracer can't break SDK semantics.
type RequestHooks struct {
	OnRequest  func(ctx HookContext)
	OnResponse func(ctx HookContext)
	OnError    func(ctx HookContext)
}

func (h RequestHooks) fire(cb func(ctx HookContext), ctx HookContext) {
	if cb == nil {
		return
	}
	defer func() { _ = recover() }()
	cb(ctx)
}

var retryableStatusCodes = map[int]struct{}{
	408: {}, 429: {}, 500: {}, 502: {}, 503: {}, 504: {},
}

type Client struct {
	senderHTTP    *httpClientConfig
	providerHTTP  *httpClientConfig
	publicHTTP    *httpClientConfig
	registry      *aggregatorRegistry
	gatewayClient *gatewayClient
}

type ClientOptions struct {
	APIKey         string
	SenderAPIKey   string
	ProviderAPIKey string
	BaseURL        string
	Timeout        time.Duration
	// RetryPolicy overrides the default retry behaviour. Zero value
	// means "use DefaultRetryPolicy".
	RetryPolicy RetryPolicy
	// Hooks lets integrators observe every request / response / error
	// without forking. Nil-value hook fields are ignored.
	Hooks RequestHooks
	// Gateway is required only when CreateOfframpOrder is invoked with
	// OfframpMethodGateway. Leave nil for API-only integrations.
	Gateway *GatewayPathConfig
}

type httpClientConfig struct {
	apiKey      string
	baseURL     string
	httpClient  *http.Client
	retryPolicy RetryPolicy
	hooks       RequestHooks
}

func NewClient(apiKey, baseURL string) *Client {
	return NewClientWithOptions(ClientOptions{APIKey: apiKey, BaseURL: baseURL})
}

func NewClientWithOptions(options ClientOptions) *Client {
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}

	timeout := options.Timeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}

	retryPolicy := options.RetryPolicy
	if retryPolicy.Retries <= 0 {
		retryPolicy = DefaultRetryPolicy
	}

	senderKey := options.SenderAPIKey
	if senderKey == "" {
		senderKey = options.APIKey
	}

	providerKey := options.ProviderAPIKey
	if providerKey == "" {
		providerKey = options.APIKey
	}

	client := &Client{}
	client.publicHTTP = newHTTPConfig("", baseURL, timeout, retryPolicy, options.Hooks)

	override := ""
	if options.Gateway != nil {
		override = options.Gateway.AggregatorPublicKey
	}
	client.registry = newAggregatorRegistry(client.publicHTTP, override)

	if options.Gateway != nil {
		gw, err := newGatewayClient(client.registry, options.Gateway)
		if err == nil {
			client.gatewayClient = gw
		}
	}

	if senderKey != "" {
		client.senderHTTP = newHTTPConfig(senderKey, baseURL, timeout, retryPolicy, options.Hooks)
	}
	if providerKey != "" {
		client.providerHTTP = newHTTPConfig(providerKey, baseURL, timeout, retryPolicy, options.Hooks)
	}

	return client
}

func newHTTPConfig(apiKey, baseURL string, timeout time.Duration, retry RetryPolicy, hooks RequestHooks) *httpClientConfig {
	return &httpClientConfig{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		retryPolicy: retry,
		hooks:       hooks,
	}
}

func (c *Client) Sender() (*SenderService, error) {
	if c.senderHTTP == nil {
		return nil, &APIError{Message: "sender api key is required", Kind: ErrValidation}
	}
	return &SenderService{http: c.senderHTTP, gateway: c.gatewayClient, publicHTTP: c.publicHTTP}, nil
}

func (c *Client) Provider() (*ProviderService, error) {
	if c.providerHTTP == nil {
		return nil, &APIError{Message: "provider api key is required", Kind: ErrValidation}
	}
	return &ProviderService{http: c.providerHTTP}, nil
}

func (c *httpClientConfig) request(ctx context.Context, method, path string, query map[string]string, body interface{}, out interface{}) error {
	return c.requestWithIdempotency(ctx, method, path, query, body, out, "")
}

// requestWithIdempotency is the internal form that allows callers (POST
// sites) to thread an Idempotency-Key through the retry loop. When
// idempotencyKey is empty and method == POST, a UUID is generated so
// retries stay linked.
func (c *httpClientConfig) requestWithIdempotency(ctx context.Context, method, path string, query map[string]string, body interface{}, out interface{}, idempotencyKey string) error {
	endpoint, err := url.Parse(c.baseURL + path)
	if err != nil {
		return err
	}

	params := endpoint.Query()
	for k, v := range query {
		if v != "" {
			params.Set(k, v)
		}
	}
	endpoint.RawQuery = params.Encode()

	policy := c.retryPolicy
	if policy.Retries <= 0 {
		policy = DefaultRetryPolicy
	}

	effectiveKey := idempotencyKey
	if effectiveKey == "" && method == http.MethodPost {
		effectiveKey = generateUUID()
	}

	var lastErr error
	for attempt := 1; attempt <= policy.Retries; attempt++ {
		hookCtx := HookContext{
			Method:         method,
			URL:            endpoint.String(),
			Attempt:        attempt,
			IdempotencyKey: effectiveKey,
		}
		c.hooks.fire(c.hooks.OnRequest, hookCtx)
		startedAt := time.Now()
		err := c.sendOnce(ctx, method, endpoint.String(), body, out, effectiveKey)
		hookCtx.Duration = time.Since(startedAt)
		if err == nil {
			hookCtx.StatusCode = 200
			c.hooks.fire(c.hooks.OnResponse, hookCtx)
			return nil
		}
		hookCtx.Err = err
		if apiErr, ok := err.(*APIError); ok {
			hookCtx.StatusCode = apiErr.StatusCode
		}
		c.hooks.fire(c.hooks.OnError, hookCtx)
		lastErr = err
		if attempt >= policy.Retries {
			break
		}
		if !isRetryableError(err, method) {
			break
		}
		waitFor := computeBackoff(attempt, err, policy)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(waitFor):
		}
	}
	return lastErr
}

func (c *httpClientConfig) sendOnce(ctx context.Context, method, endpoint string, body interface{}, out interface{}, idempotencyKey string) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewBuffer(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	if c.apiKey != "" {
		req.Header.Set("API-Key", c.apiKey)
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return &APIError{Kind: ErrNetwork, Message: "network error calling Paycrest API", Details: err.Error()}
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return &APIError{Kind: ErrNetwork, Message: "failed to read response body", Details: err.Error()}
	}

	if resp.StatusCode >= 400 {
		var parsed map[string]interface{}
		_ = json.Unmarshal(rawBody, &parsed)
		message, _ := parsed["message"].(string)
		if message == "" {
			message = "Paycrest API request failed"
		}
		var retryAfter float64
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if v, parseErr := strconv.ParseFloat(ra, 64); parseErr == nil {
				retryAfter = v
			}
		}
		return classifyHTTPError(resp.StatusCode, message, parsed["data"], retryAfter)
	}

	if out == nil {
		return nil
	}
	return json.Unmarshal(rawBody, out)
}

func isRetryableError(err error, method string) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	// Pre-acknowledgment transport errors are always safe to retry.
	if apiErr.Kind == ErrNetwork {
		return true
	}
	// Acknowledged server errors: retry only on idempotent verbs.
	if method != http.MethodGet {
		return false
	}
	_, ok := retryableStatusCodes[apiErr.StatusCode]
	return ok
}

func computeBackoff(attempt int, err error, policy RetryPolicy) time.Duration {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Kind == ErrRateLimit && apiErr.RetryAfterSeconds > 0 {
		wait := time.Duration(apiErr.RetryAfterSeconds * float64(time.Second))
		if wait > policy.MaxDelay {
			return policy.MaxDelay
		}
		return wait
	}
	exponent := time.Duration(1<<uint(attempt-1)) * policy.BaseDelay
	jittered := time.Duration(mrand.Int63n(int64(exponent) + 1))
	if jittered > policy.MaxDelay {
		return policy.MaxDelay
	}
	return jittered
}

// generateUUID produces a UUIDv4 string suitable for Idempotency-Key
// headers. Crypto/rand is used so two processes never collide.
func generateUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand should never fail in practice; fall back to a
		// timestamp-based token so POSTs still carry *some* key.
		return "00000000-0000-0000-0000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122
	hex32 := hex.EncodeToString(b[:])
	return hex32[0:8] + "-" + hex32[8:12] + "-" + hex32[12:16] + "-" + hex32[16:20] + "-" + hex32[20:32]
}
