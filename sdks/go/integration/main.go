package main

import (
	"context"
	"fmt"
	"log"
	"os"

	sdk "github.com/paycrest/sdk-go/sdk"
)

func requiredEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("missing required env var: %s", name)
	}
	return value
}

func main() {
	baseURL := os.Getenv("PAYCREST_BASE_URL")
	if baseURL == "" {
		baseURL = sdk.DefaultBaseURL
	}

	client := sdk.NewClientWithOptions(sdk.ClientOptions{
		SenderAPIKey:   requiredEnv("PAYCREST_SENDER_API_KEY"),
		ProviderAPIKey: requiredEnv("PAYCREST_PROVIDER_API_KEY"),
		BaseURL:        baseURL,
	})

	ctx := context.Background()

	sender, err := client.Sender()
	if err != nil {
		log.Fatalf("sender init failed: %v", err)
	}
	senderStats, err := sender.GetStats(ctx)
	if err != nil {
		log.Fatalf("sender get_stats failed: %v", err)
	}

	provider, err := client.Provider()
	if err != nil {
		log.Fatalf("provider init failed: %v", err)
	}
	providerStats, err := provider.GetStats(ctx, os.Getenv("PAYCREST_FIAT"))
	if err != nil {
		log.Fatalf("provider get_stats failed: %v", err)
	}

	network := requiredEnv("PAYCREST_NETWORK")
	token := requiredEnv("PAYCREST_TOKEN")
	fiat := requiredEnv("PAYCREST_FIAT")
	amount := os.Getenv("PAYCREST_AMOUNT")
	if amount == "" {
		amount = "100"
	}

	quote, err := sender.GetTokenRate(ctx, network, token, amount, fiat, "sell", "")
	if err != nil {
		log.Fatalf("sender get_token_rate failed: %v", err)
	}
	if quote.Sell == nil || quote.Sell.Rate == "" {
		log.Fatal("sender get_token_rate returned no sell quote rate")
	}

	fmt.Printf("go integration passed: senderStats=%d providerStats=%d sellRate=%s\n", senderStats.TotalOrders, providerStats.TotalOrders, quote.Sell.Rate)
}
