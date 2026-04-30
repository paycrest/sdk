package sdk

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const webhookSecret = "test-secret"

func signBody(body string) string {
	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write([]byte(body))
	return hex.EncodeToString(mac.Sum(nil))
}

func TestParseWebhookHappyPath(t *testing.T) {
	body := `{"event":"order.settled","data":{"id":"ord-1","status":"settled"}}`
	event, err := ParseWebhook([]byte(body), signBody(body), webhookSecret)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.Event != "order.settled" {
		t.Fatalf("unexpected event: %s", event.Event)
	}
	var data map[string]any
	if err := json.Unmarshal(event.Data, &data); err != nil {
		t.Fatalf("failed to decode data: %v", err)
	}
	if data["id"] != "ord-1" {
		t.Fatalf("unexpected id: %v", data["id"])
	}
}

func TestParseWebhookMissingSignature(t *testing.T) {
	_, err := ParseWebhook([]byte(`{}`), "", webhookSecret)
	if !errors.Is(err, ErrMissingSignature) {
		t.Fatalf("expected ErrMissingSignature, got %v", err)
	}
}

func TestParseWebhookBadSignature(t *testing.T) {
	_, err := ParseWebhook([]byte(`{}`), "deadbeef", webhookSecret)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("expected ErrInvalidSignature, got %v", err)
	}
}

func TestParseWebhookInvalidJSON(t *testing.T) {
	body := "{ not json"
	_, err := ParseWebhook([]byte(body), signBody(body), webhookSecret)
	if err == nil || !strings.Contains(err.Error(), "invalid JSON") {
		t.Fatalf("expected invalid JSON error, got %v", err)
	}
}

func TestWebhookHandlerRejectsBadSignature(t *testing.T) {
	var called bool
	handler := WebhookHandler(webhookSecret, nil, func(_ *WebhookEvent, _ *http.Request) error {
		called = true
		return nil
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wh", strings.NewReader("{}"))
	req.Header.Set("X-Paycrest-Signature", "wrong")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if called {
		t.Fatal("onEvent must not be called for invalid signature")
	}
}

func TestWebhookHandlerDeliversVerifiedEvent(t *testing.T) {
	body := `{"event":"order.pending","data":{"id":"ord-2"}}`
	var gotEvent *WebhookEvent
	handler := WebhookHandler(webhookSecret, nil, func(e *WebhookEvent, _ *http.Request) error {
		gotEvent = e
		return nil
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wh", strings.NewReader(body))
	req.Header.Set("X-Paycrest-Signature", signBody(body))
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if gotEvent == nil || gotEvent.Event != "order.pending" {
		t.Fatalf("unexpected event: %+v", gotEvent)
	}
}
