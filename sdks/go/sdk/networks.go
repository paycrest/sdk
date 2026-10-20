package sdk

import (
	"fmt"
	"strings"
	"sync"
)

// NetworkInfo describes a single Paycrest-supported chain.
type NetworkInfo struct {
	Slug        string
	ChainID     int64
	DisplayName string
	Gateway     string
}

var (
	networksMu sync.RWMutex
	networks   = map[string]NetworkInfo{
		"base":            {Slug: "base", ChainID: 8453, DisplayName: "Base", Gateway: "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f"},
		"arbitrum-one":    {Slug: "arbitrum-one", ChainID: 42161, DisplayName: "Arbitrum One", Gateway: "0xe8bc3b607cfe68f47000e3d200310d49041148fc"},
		"bnb-smart-chain": {Slug: "bnb-smart-chain", ChainID: 56, DisplayName: "BNB Smart Chain", Gateway: "0x1fa0ee7f9410f6fa49b7ad5da72cf01647090028"},
		"polygon":         {Slug: "polygon", ChainID: 137, DisplayName: "Polygon", Gateway: "0xfb411cc6385af50a562afcb441864e9d541cda67"},
		"celo":            {Slug: "celo", ChainID: 42220, DisplayName: "Celo", Gateway: "0xf418217e3f81092ef44b81c5c8336e6a6fdb0e4b"},
		"ethereum":        {Slug: "ethereum", ChainID: 1, DisplayName: "Ethereum", Gateway: "0x8d2c0d398832b814e3814802ff2dc8b8ef4381e5"},
	}
)

// GetNetwork returns the canonical network entry for a slug.
func GetNetwork(slug string) (NetworkInfo, error) {
	networksMu.RLock()
	defer networksMu.RUnlock()
	info, ok := networks[strings.ToLower(slug)]
	if !ok {
		known := make([]string, 0, len(networks))
		for k := range networks {
			known = append(known, k)
		}
		return NetworkInfo{}, fmt.Errorf("unsupported network %q; known: %v", slug, known)
	}
	return info, nil
}

// RegisterNetwork adds or overrides a network entry at runtime.
func RegisterNetwork(info NetworkInfo) {
	networksMu.Lock()
	defer networksMu.Unlock()
	networks[strings.ToLower(info.Slug)] = info
}
