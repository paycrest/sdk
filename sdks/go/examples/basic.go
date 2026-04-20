package main

import (
	"context"
	"fmt"
	"os"

	"github.com/paycrest/sdk-go/sdk"
)

func main() {
	apiKey := os.Getenv("PAYCREST_API_KEY")
	client := sdk.NewClient(apiKey, sdk.DefaultBaseURL)

	stats, err := client.Sender().GetStats(context.Background())
	if err != nil {
		panic(err)
	}

	fmt.Printf("stats: %+v\n", stats)
}
