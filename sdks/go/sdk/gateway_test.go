package sdk

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"testing"
)

// Round-trip an encrypted envelope through a fresh RSA keypair to prove
// the byte layout matches the aggregator's EncryptOrderRecipient spec.
func TestEncryptionEnvelopeRoundTrip(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa: %v", err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("marshal pub: %v", err)
	}
	pubPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))

	payload, err := BuildRecipientPayload("GTBINGLA", "1234567890", "Jane Doe", "Payout", "AbCdEfGh", nil)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	envelopeB64, err := EncryptRecipientPayload(payload, pubPEM)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	envelope, err := base64.StdEncoding.DecodeString(envelopeB64)
	if err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	keyLen := binary.BigEndian.Uint32(envelope[:4])
	encryptedKey := envelope[4 : 4+keyLen]
	aesBlock := envelope[4+keyLen:]

	aesKey, err := rsa.DecryptPKCS1v15(rand.Reader, priv, encryptedKey)
	if err != nil {
		t.Fatalf("rsa decrypt: %v", err)
	}
	block, err := aes.NewCipher(aesKey)
	if err != nil {
		t.Fatalf("aes cipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("gcm: %v", err)
	}
	nonce := aesBlock[:gcm.NonceSize()]
	ciphertext := aesBlock[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(plaintext, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded["Institution"] != "GTBINGLA" {
		t.Fatalf("expected Institution=GTBINGLA, got %v", decoded["Institution"])
	}
	if decoded["AccountIdentifier"] != "1234567890" {
		t.Fatalf("expected AccountIdentifier, got %v", decoded["AccountIdentifier"])
	}
	if decoded["ProviderID"] != "AbCdEfGh" {
		t.Fatalf("expected ProviderID=AbCdEfGh, got %v", decoded["ProviderID"])
	}
	if _, ok := decoded["Nonce"].(string); !ok {
		t.Fatalf("expected Nonce string")
	}
}

func TestToSubunits(t *testing.T) {
	cases := []struct {
		amount   string
		decimals int
		want     string
	}{
		{"1", 6, "1000000"},
		{"1.5", 6, "1500000"},
		{"0.000001", 6, "1"},
		{"100", 18, "100000000000000000000"},
	}
	for _, tc := range cases {
		got, err := ToSubunits(tc.amount, tc.decimals)
		if err != nil {
			t.Fatalf("ToSubunits(%q, %d): %v", tc.amount, tc.decimals, err)
		}
		if got.String() != tc.want {
			t.Fatalf("ToSubunits(%q, %d) = %s, want %s", tc.amount, tc.decimals, got.String(), tc.want)
		}
	}
	if _, err := ToSubunits("0.0000001", 6); err == nil {
		t.Fatal("expected error for too-fine decimal")
	}
	if _, err := ToSubunits("abc", 6); err == nil {
		t.Fatal("expected error for non-numeric input")
	}
}

func TestScaleRate(t *testing.T) {
	cases := map[string]string{
		"1500":    "150000",
		"1499.99": "149999",
		"1.23":    "123",
	}
	for rate, want := range cases {
		got, err := ScaleRate(rate)
		if err != nil {
			t.Fatalf("ScaleRate(%q): %v", rate, err)
		}
		if got.String() != want {
			t.Fatalf("ScaleRate(%q) = %s, want %s", rate, got.String(), want)
		}
	}
}

func TestGetNetwork(t *testing.T) {
	base, err := GetNetwork("base")
	if err != nil {
		t.Fatalf("GetNetwork(base): %v", err)
	}
	if base.ChainID != 8453 {
		t.Fatalf("expected chainId 8453, got %d", base.ChainID)
	}
	if base.Gateway != "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f" {
		t.Fatalf("unexpected gateway: %s", base.Gateway)
	}
	if _, err := GetNetwork("does-not-exist"); err == nil {
		t.Fatal("expected error for unknown network")
	}
}

// mockTransactor records calls and returns canned responses. Used to
// exercise the gateway dispatch path without any real RPC backend.
type mockTransactor struct {
	chainID          int64
	from             string
	allowance        *big.Int
	approveHashValue string
	createHashValue  string
	approveCalled    bool
	createArgs       *GatewayCreateOrderArgs
	createGateway    string
}

func (m *mockTransactor) ChainID(_ context.Context) (*big.Int, error) {
	return big.NewInt(m.chainID), nil
}
func (m *mockTransactor) From() string { return m.from }
func (m *mockTransactor) Allowance(_ context.Context, _ string, _ string, _ string) (*big.Int, error) {
	return m.allowance, nil
}
func (m *mockTransactor) Approve(_ context.Context, _ string, _ string, _ *big.Int) (string, error) {
	m.approveCalled = true
	return m.approveHashValue, nil
}
func (m *mockTransactor) CreateOrder(_ context.Context, gateway string, args GatewayCreateOrderArgs) (string, error) {
	m.createArgs = &args
	m.createGateway = gateway
	return m.createHashValue, nil
}

func TestGatewayDispatchPipeline(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	pubDER, _ := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	pubPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))

	transactor := &mockTransactor{
		chainID:          8453,
		from:             "0xSenderEoa0000000000000000000000000000000",
		allowance:        big.NewInt(0),
		approveHashValue: "0xApproveTxHash",
		createHashValue:  "0xCreateTxHash",
	}

	// Fake registry backed by in-memory values (bypass HTTP).
	registry := &aggregatorRegistry{
		publicKeyOverride: pubPEM,
		tokensByNetwork: map[string][]SupportedToken{
			"base": {
				{Symbol: "USDT", ContractAddress: "0xTokenAddress", Decimals: 6, BaseCurrency: "USD", Network: "base"},
			},
		},
	}

	gw, err := newGatewayClient(registry, &GatewayPathConfig{Transactor: transactor, AggregatorPublicKey: pubPEM})
	if err != nil {
		t.Fatalf("new gateway client: %v", err)
	}

	rateResolver := func(_ context.Context, _, _, _, _ string) (string, error) {
		return "1500", nil
	}

	result, err := gw.createOfframpOrder(context.Background(), OfframpOrderPayload{
		Amount: "100",
		Source: CryptoSourceInput{
			Currency:      "USDT",
			Network:       "base",
			RefundAddress: "0xRefundAddress",
		},
		Destination: FiatDestinationInput{
			Currency: "NGN",
			Recipient: FiatRecipientInput{
				Institution:       "GTBINGLA",
				AccountIdentifier: "1234567890",
				AccountName:       "Jane Doe",
				Memo:              "Payout",
			},
		},
	}, rateResolver)
	if err != nil {
		t.Fatalf("createOfframpOrder: %v", err)
	}

	if !transactor.approveCalled {
		t.Fatal("expected approve to be called when allowance=0")
	}
	if result.ApproveTxHash != "0xApproveTxHash" {
		t.Fatalf("unexpected approve hash: %s", result.ApproveTxHash)
	}
	if result.TxHash != "0xCreateTxHash" {
		t.Fatalf("unexpected create tx hash: %s", result.TxHash)
	}
	if result.GatewayAddress != "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f" {
		t.Fatalf("unexpected gateway: %s", result.GatewayAddress)
	}
	if result.Amount.String() != "100000000" {
		t.Fatalf("expected amount 100000000, got %s", result.Amount)
	}
	if transactor.createArgs.Rate.String() != "150000" {
		t.Fatalf("expected rate 150000, got %s", transactor.createArgs.Rate)
	}
	if transactor.createArgs.RefundAddress != "0xRefundAddress" {
		t.Fatalf("expected refund override, got %s", transactor.createArgs.RefundAddress)
	}
	if transactor.createArgs.MessageHash == "" {
		t.Fatal("expected non-empty messageHash")
	}

	// Confirm the messageHash decrypts with our test private key.
	envelope, err := base64.StdEncoding.DecodeString(transactor.createArgs.MessageHash)
	if err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	keyLen := binary.BigEndian.Uint32(envelope[:4])
	encryptedKey := envelope[4 : 4+keyLen]
	aesBlock := envelope[4+keyLen:]
	aesKey, err := rsa.DecryptPKCS1v15(rand.Reader, priv, encryptedKey)
	if err != nil {
		t.Fatalf("rsa decrypt: %v", err)
	}
	block, _ := aes.NewCipher(aesKey)
	gcm, _ := cipher.NewGCM(block)
	plaintext, err := gcm.Open(nil, aesBlock[:gcm.NonceSize()], aesBlock[gcm.NonceSize():], nil)
	if err != nil {
		t.Fatalf("gcm open: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(plaintext, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded["AccountIdentifier"] != "1234567890" {
		t.Fatalf("unexpected recipient payload: %v", decoded)
	}
}

// Smoke: chain id mismatch should fail fast with a helpful error.
func TestGatewayChainIDMismatch(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	pubDER, _ := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	pubPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))

	transactor := &mockTransactor{chainID: 1, from: "0xAbc", allowance: big.NewInt(0)}
	registry := &aggregatorRegistry{publicKeyOverride: pubPEM, tokensByNetwork: map[string][]SupportedToken{
		"base": {{Symbol: "USDT", ContractAddress: "0xTok", Decimals: 6, BaseCurrency: "USD", Network: "base"}},
	}}

	gw, _ := newGatewayClient(registry, &GatewayPathConfig{Transactor: transactor, AggregatorPublicKey: pubPEM})
	_, err := gw.createOfframpOrder(context.Background(), OfframpOrderPayload{
		Amount: "100",
		Source: CryptoSourceInput{Currency: "USDT", Network: "base"},
		Destination: FiatDestinationInput{Currency: "NGN", Recipient: FiatRecipientInput{
			Institution: "X", AccountIdentifier: "1", AccountName: "Y", Memo: "m",
		}},
	}, func(_ context.Context, _, _, _, _ string) (string, error) { return "1500", nil })
	if err == nil || !contains(err.Error(), "chainId=1") {
		t.Fatalf("expected chain id mismatch error, got %v", err)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (len(sub) == 0 || (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	}()))
}

// Compile-time guard: ClientOptions.Gateway is optional.
var _ = func() error {
	_ = ClientOptions{Gateway: &GatewayPathConfig{Transactor: nil}}
	_ = fmt.Sprintf
	return nil
}
