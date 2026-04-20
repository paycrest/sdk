package sdk

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestVerifyWebhookSignature(t *testing.T) {
	body := `{"status":"settled"}`
	secret := "secret"

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	sig := hex.EncodeToString(mac.Sum(nil))

	if !VerifyWebhookSignature(body, sig, secret) {
		t.Fatalf("expected signature to be valid")
	}
	if VerifyWebhookSignature(body, "invalid", secret) {
		t.Fatalf("expected signature to be invalid")
	}
}
