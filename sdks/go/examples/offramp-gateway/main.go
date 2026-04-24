// Off-ramp via the direct Gateway contract path (method="gateway").
//
// The Paycrest Go SDK stays web3-library-agnostic by delegating signing
// and broadcasting to a caller-supplied `sdk.GatewayTransactor`. This
// file sketches a go-ethereum adapter — paste it into your integrator
// and plug in your own RPC URL + private key.
package main

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"os"
	"strings"

	sdk "github.com/paycrest/sdk-go/sdk"
)

// The real adapter would import:
//
//   "github.com/ethereum/go-ethereum/accounts/abi"
//   "github.com/ethereum/go-ethereum/accounts/abi/bind"
//   "github.com/ethereum/go-ethereum/common"
//   "github.com/ethereum/go-ethereum/crypto"
//   "github.com/ethereum/go-ethereum/ethclient"
//
// and implement sdk.GatewayTransactor with:
//
//   - ChainID()     : ethclient.ChainID(ctx)
//   - From()        : address derived from the private key
//   - Allowance(..) : abi.Pack("allowance", ...) -> eth_call -> abi.Unpack
//   - Approve(..)   : abi.Pack("approve", ...)   -> signed tx -> SendTransaction
//   - CreateOrder(..): abi.Pack("createOrder", ...) with sdk.GatewayABI
//
// Keeping the adapter in userland lets you bring your own gas strategy
// (EIP-1559, EIP-7702 batching, bundlers, etc.) without the SDK having
// opinions.

type dummyTransactor struct{}

func (dummyTransactor) ChainID(_ context.Context) (*big.Int, error) {
	return big.NewInt(8453), nil
}
func (dummyTransactor) From() string { return "0xSenderEoa" }
func (dummyTransactor) Allowance(_ context.Context, _, _, _ string) (*big.Int, error) {
	return big.NewInt(0), nil
}
func (dummyTransactor) Approve(_ context.Context, _, _ string, _ *big.Int) (string, error) {
	return "0xApproveTxHash", nil
}
func (dummyTransactor) CreateOrder(_ context.Context, _ string, _ sdk.GatewayCreateOrderArgs) (string, error) {
	return "0xCreateTxHash", nil
}

func main() {
	if len(os.Args) > 1 && strings.ToLower(os.Args[1]) == "--real" {
		log.Fatal("Replace dummyTransactor with a go-ethereum-backed implementation; see inline comments.")
	}

	client := sdk.NewClientWithOptions(sdk.ClientOptions{
		SenderAPIKey: os.Getenv("PAYCREST_SENDER_API_KEY"),
		Gateway: &sdk.GatewayPathConfig{
			Transactor: dummyTransactor{},
		},
	})
	sender, err := client.Sender()
	if err != nil {
		log.Fatal(err)
	}

	result, err := sender.CreateOfframpOrderWithMethod(context.Background(),
		sdk.OfframpOrderPayload{
			Amount: "100",
			Rate:   "1500",
			Source: sdk.CryptoSourceInput{
				Currency:      "USDT",
				Network:       "base",
				RefundAddress: "0xSenderEoa",
			},
			Destination: sdk.FiatDestinationInput{
				Currency: "NGN",
				Recipient: sdk.FiatRecipientInput{
					Institution:       "GTBINGLA",
					AccountIdentifier: "1234567890",
					AccountName:       "Jane Doe",
					Memo:              "Payout",
				},
			},
		},
		sdk.CreateOfframpOptions{Method: sdk.OfframpMethodGateway},
	)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("method=%s gateway=%+v\n", result.Method, result.Gateway)
}
