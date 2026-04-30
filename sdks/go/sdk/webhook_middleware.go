package sdk

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// WebhookEvent is the parsed + verified webhook envelope. Callers
// typically decode `Data` into their own typed struct.
type WebhookEvent struct {
	Event     string          `json:"event,omitempty"`
	Timestamp string          `json:"timestamp,omitempty"`
	Data      json.RawMessage `json:"data"`
}

// ErrInvalidSignature is returned when HMAC verification fails.
var ErrInvalidSignature = errors.New("paycrest webhook: invalid signature")

// ErrMissingSignature is returned when no signature header is present.
var ErrMissingSignature = errors.New("paycrest webhook: missing signature")

// ParseWebhook verifies the HMAC-SHA256 signature of `body` against
// `secret` and, on success, decodes the envelope. Use this from any
// HTTP framework (chi, echo, gin, stdlib) that gives you access to the
// raw body + signature header.
func ParseWebhook(body []byte, signature, secret string) (*WebhookEvent, error) {
	if signature == "" {
		return nil, ErrMissingSignature
	}
	if !VerifyWebhookSignature(string(body), signature, secret) {
		return nil, ErrInvalidSignature
	}
	var event WebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, fmt.Errorf("paycrest webhook: invalid JSON body: %w", err)
	}
	return &event, nil
}

// WebhookHandlerOptions controls the behaviour of WebhookHandler.
type WebhookHandlerOptions struct {
	// SignatureHeader is the incoming request header carrying the
	// signature. Defaults to "X-Paycrest-Signature".
	SignatureHeader string
}

// WebhookHandler returns an http.Handler that verifies the signature
// and hands the parsed event to `onEvent`. Any error returned from
// `onEvent` becomes a 500; successful handling returns 200.
//
//	http.Handle("/webhooks/paycrest", sdk.WebhookHandler(secret, nil, func(e *sdk.WebhookEvent, r *http.Request) error {
//	    log.Printf("received %s for %s", e.Event, e.Data)
//	    return nil
//	}))
func WebhookHandler(
	secret string,
	opts *WebhookHandlerOptions,
	onEvent func(event *WebhookEvent, r *http.Request) error,
) http.Handler {
	signatureHeader := "X-Paycrest-Signature"
	if opts != nil && opts.SignatureHeader != "" {
		signatureHeader = opts.SignatureHeader
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()
		// Replace the request body so downstream handlers can still read it.
		r.Body = io.NopCloser(bytes.NewReader(body))

		event, err := ParseWebhook(body, r.Header.Get(signatureHeader), secret)
		if err != nil {
			status := http.StatusUnauthorized
			if strings.Contains(err.Error(), "invalid JSON") {
				status = http.StatusBadRequest
			}
			http.Error(w, err.Error(), status)
			return
		}

		if onEvent != nil {
			if err := onEvent(event, r); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
	})
}
