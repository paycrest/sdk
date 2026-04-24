package sdk

import (
	"math/big"
	"testing"
)

func TestGatewayBuildCreateOrderCall(t *testing.T) {
	gw, err := NewGateway("0x1111111111111111111111111111111111111111", "base")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	call := gw.BuildCreateOrderCall(GatewayCreateOrderParams{
		Token:              "0x2222222222222222222222222222222222222222",
		Amount:             big.NewInt(1000000),
		Rate:               big.NewInt(1500),
		SenderFeeRecipient: "0x3333333333333333333333333333333333333333",
		SenderFee:          big.NewInt(0),
		RefundAddress:      "0x4444444444444444444444444444444444444444",
		MessageHash:        "QmMessageCid",
	})

	if call.To != "0x1111111111111111111111111111111111111111" {
		t.Fatalf("unexpected to: %s", call.To)
	}
	if call.FunctionName != "createOrder" {
		t.Fatalf("unexpected function: %s", call.FunctionName)
	}
	if call.Value != "0" {
		t.Fatalf("unexpected value: %s", call.Value)
	}
	if len(call.Args) != 7 {
		t.Fatalf("expected 7 args, got %d", len(call.Args))
	}
	if call.Args[6].(string) != "QmMessageCid" {
		t.Fatalf("unexpected messageHash arg: %v", call.Args[6])
	}
}

func TestGatewayRegistryLookup(t *testing.T) {
	if _, err := GatewayForNetwork("no-such-net", ""); err == nil {
		t.Fatal("expected error for unregistered network")
	}

	RegisterGatewayAddress("test-net", "0xABCDEF0000000000000000000000000000000000")
	gw, err := GatewayForNetwork("test-net", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gw.Address != "0xABCDEF0000000000000000000000000000000000" {
		t.Fatalf("unexpected address: %s", gw.Address)
	}

	override, err := GatewayForNetwork("test-net", "0x9999999999999999999999999999999999999999")
	if err != nil {
		t.Fatalf("unexpected error with override: %v", err)
	}
	if override.Address != "0x9999999999999999999999999999999999999999" {
		t.Fatalf("override did not take precedence, got %s", override.Address)
	}
}

func TestGatewayGetOrderInfoCall(t *testing.T) {
	gw, err := NewGateway("0x1111111111111111111111111111111111111111", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	call := gw.BuildGetOrderInfoCall("0x0000000000000000000000000000000000000000000000000000000000000001")
	if call.FunctionName != "getOrderInfo" {
		t.Fatalf("unexpected function: %s", call.FunctionName)
	}
	if len(call.Args) != 1 {
		t.Fatalf("expected 1 arg, got %d", len(call.Args))
	}
}

func TestGatewayABIIsValidJSON(t *testing.T) {
	if err := ValidateABI(); err != nil {
		t.Fatalf("gateway ABI is not valid JSON: %v", err)
	}
}

func TestNewGatewayRequiresAddress(t *testing.T) {
	if _, err := NewGateway("", ""); err == nil {
		t.Fatal("expected error for empty address")
	}
}
