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
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewClient(apiKey, baseURL string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}

	return &Client{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *Client) Sender() *SenderService {
	return &SenderService{client: c}
}

func (c *Client) Provider() (*struct{}, error) {
	return nil, &APIError{Message: "provider sdk support is not available yet in v2 monorepo"}
}

func (c *Client) request(ctx context.Context, method, path string, query map[string]string, body interface{}, out interface{}) error {
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
