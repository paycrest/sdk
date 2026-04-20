#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/go"

if ! command -v go1.26.0 >/dev/null 2>&1; then
    echo "go1.26.0 is required for Go integration tests"
    exit 1
fi

if [[ -z "${PAYCREST_BASE_URL:-}" ]]; then
    export PAYCREST_BASE_URL="https://api.paycrest.io/v2"
fi

if [[ -z "${PAYCREST_SENDER_API_KEY:-}" ]]; then
    echo "PAYCREST_SENDER_API_KEY not set, skipping Go sender integration test"
    exit 0
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

cat > "$tmp_file" <<'EOF'
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
		baseURL = sdk.DefaultBaseURL
	}

	client := sdk.NewClientWithOptions(sdk.ClientOptions{
		SenderAPIKey: os.Getenv("PAYCREST_SENDER_API_KEY"),
		BaseURL:      baseURL,
	})
	sender, err := client.Sender()
	if err != nil {
		panic(err)
	}

	stats, err := sender.GetStats(context.Background())
	if err != nil {
		panic(err)
	}

	fmt.Printf("go sender stats ok: %+v\n", *stats)
}
EOF

go1.26.0 run "$tmp_file"

if [[ -z "${PAYCREST_PROVIDER_API_KEY:-}" ]]; then
    echo "PAYCREST_PROVIDER_API_KEY not set, skipping Go provider integration test"
    exit 0
fi

cat > "$tmp_file" <<'EOF'
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
		baseURL = sdk.DefaultBaseURL
	}

	client := sdk.NewClientWithOptions(sdk.ClientOptions{
		ProviderAPIKey: os.Getenv("PAYCREST_PROVIDER_API_KEY"),
		BaseURL:        baseURL,
	})
	provider, err := client.Provider()
	if err != nil {
		panic(err)
	}

	stats, err := provider.GetStats(context.Background(), "")
	if err != nil {
		panic(err)
	}

	fmt.Printf("go provider stats ok: %+v\n", *stats)
}
EOF

go1.26.0 run "$tmp_file"
