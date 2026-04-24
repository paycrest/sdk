// Cross-SDK parity client (Go).
package main

import (
	"context"
	"fmt"
	"os"

	sdk "github.com/paycrest/sdk-go/sdk"
)

func main() {
	baseURL := os.Getenv("PAYCREST_BASE_URL")
	if baseURL == "" {
		fmt.Fprintln(os.Stderr, "PAYCREST_BASE_URL is required")
		os.Exit(1)
	}

	client := sdk.NewClientWithOptions(sdk.ClientOptions{
		SenderAPIKey: "parity-key",
		BaseURL:      baseURL,
	})
	sender, err := client.Sender()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	order, err := sender.CreateOfframpOrder(context.Background(), map[string]interface{}{
		"amount": "100",
		"source": map[string]interface{}{
			"type":          "crypto",
			"currency":      "USDT",
			"network":       "base",
			"refundAddress": "0xabc",
		},
		"destination": map[string]interface{}{
			"type":     "fiat",
			"currency": "NGN",
			"recipient": map[string]interface{}{
				"institution":       "GTBINGLA",
				"accountIdentifier": "1234567890",
				"accountName":       "Jane Doe",
				"memo":              "Payout",
			},
		},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if order.ID == "" {
		fmt.Fprintln(os.Stderr, "go-client: no order id returned")
		os.Exit(2)
	}
	refreshed, err := sender.GetOrder(context.Background(), order.ID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(3)
	}
	if refreshed.Status != "settled" {
		fmt.Fprintf(os.Stderr, "go-client: unexpected status %s\n", refreshed.Status)
		os.Exit(3)
	}
	fmt.Println("go-client: OK")
}
