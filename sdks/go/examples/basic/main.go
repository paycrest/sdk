package main

import (
	"context"
	"fmt"
	"os"

	"github.com/paycrest/sdk-go/sdk"
)

func main() {
	client := sdk.NewClientWithOptions(sdk.ClientOptions{
		SenderAPIKey: os.Getenv("PAYCREST_SENDER_API_KEY"),
		BaseURL:      sdk.DefaultBaseURL,
	})

	sender, err := client.Sender()
	if err != nil {
		panic(err)
	}

	stats, err := sender.GetStats(context.Background())
	if err != nil {
		panic(err)
	}

	fmt.Printf("stats: %+v\n", stats)
}
