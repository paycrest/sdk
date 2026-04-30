# paycrest-sdk (Go)

Official Paycrest SDK for Go — sender, provider, and direct on-chain off-ramp via the Paycrest Gateway contract.

## Install

```bash
go get github.com/paycrest/sdk-go/sdk
```

## Quickstart

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    sdk "github.com/paycrest/sdk-go/sdk"
)

func main() {
    client := sdk.NewClientWithOptions(sdk.ClientOptions{
        SenderAPIKey: os.Getenv("PAYCREST_SENDER_API_KEY"),
    })
    sender, err := client.Sender()
    if err != nil {
        log.Fatal(err)
    }

    order, err := sender.CreateOfframpOrder(context.Background(), map[string]interface{}{
        "amount": "100",
        "source": map[string]interface{}{
            "type":          "crypto",
            "currency":      "USDT",
            "network":       "base",
            "refundAddress": "0xabc...",
        },
        "destination": map[string]interface{}{
            "type":     "fiat",
            "currency": "NGN",
            "recipient": map[string]interface{}{
                "institution":       "GTBINGLA",
                "accountIdentifier": "1234567890",
                "accountName":       "Jane Doe",
                "memo":              "Invoice 42",
            },
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(order.ID)

    // Wait until the order reaches a terminal state.
    final, err := sender.WaitForStatus(context.Background(), order.ID, "terminal", sdk.WaitForStatusOptions{})
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(final.Status)
}
```

## Direct-contract off-ramp

The SDK is web3-library-agnostic. Implement `sdk.GatewayTransactor` with go-ethereum / abigen / your own signer and pass it via `ClientOptions.Gateway`. See `examples/offramp-gateway/` for a stub.

## Full docs

- Repository: <https://github.com/paycrest/sdk>
- Step-by-step walkthrough: <https://github.com/paycrest/sdk/blob/main/docs/sandbox-walkthrough.md>
- Aggregator API reference: <https://docs.paycrest.io>

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`).
