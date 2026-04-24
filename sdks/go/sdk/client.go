package sdk

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"
)

const DefaultBaseURL = "https://api.paycrest.io/v2"

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
	// Gateway is required only when CreateOfframpOrder is invoked with
	// OfframpMethodGateway. Leave nil for API-only integrations.
	Gateway *GatewayPathConfig
}

type httpClientConfig struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
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

	senderKey := options.SenderAPIKey
	if senderKey == "" {
		senderKey = options.APIKey
	}

	providerKey := options.ProviderAPIKey
	if providerKey == "" {
		providerKey = options.APIKey
	}

	client := &Client{}
	client.publicHTTP = &httpClientConfig{
		apiKey:  "",
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}

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
		client.senderHTTP = &httpClientConfig{
			apiKey:  senderKey,
			baseURL: baseURL,
			httpClient: &http.Client{
				Timeout: timeout,
			},
		}
	}
	if providerKey != "" {
		client.providerHTTP = &httpClientConfig{
			apiKey:  providerKey,
			baseURL: baseURL,
			httpClient: &http.Client{
				Timeout: timeout,
			},
		}
	}

	return client
}

func (c *Client) Sender() (*SenderService, error) {
	if c.senderHTTP == nil {
		return nil, &APIError{Message: "sender api key is required"}
	}
	return &SenderService{http: c.senderHTTP, gateway: c.gatewayClient, publicHTTP: c.publicHTTP}, nil
}

func (c *Client) Provider() (*ProviderService, error) {
	if c.providerHTTP == nil {
		return nil, &APIError{Message: "provider api key is required"}
	}
	return &ProviderService{http: c.providerHTTP}, nil
}

func (c *httpClientConfig) request(ctx context.Context, method, path string, query map[string]string, body interface{}, out interface{}) error {
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

	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewBuffer(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint.String(), reader)
	if err != nil {
		return err
	}
	req.Header.Set("API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode >= 400 {
		var parsed map[string]interface{}
		_ = json.Unmarshal(rawBody, &parsed)
		message, _ := parsed["message"].(string)
		return &APIError{StatusCode: resp.StatusCode, Message: message, Details: parsed["data"]}
	}

	return json.Unmarshal(rawBody, out)
}
