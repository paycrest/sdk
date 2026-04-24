package sdk

import (
	"context"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// GatewayTransactor is the minimal surface the SDK needs from a
// caller-supplied web3 client (go-ethereum, rpc.Client, abigen bindings,
// anything). It keeps the core SDK dependency-free while still letting
// the "gateway" dispatch method do everything on the user's behalf:
// the SDK resolves network/token metadata, encrypts the recipient, and
// tells the transactor exactly what to approve and what createOrder
// call to broadcast.
//
// A go-ethereum-based implementation ships as a separate package under
// `sdks/go/gogeth` (see that package for a copy-pasteable adapter).
type GatewayTransactor interface {
	// ChainID returns the chain id of the signer's currently-connected
	// RPC backend. Used to guard against network/signer mismatches.
	ChainID(ctx context.Context) (*big.Int, error)
	// From returns the signer's EVM account address (lowercase hex,
	// `0x`-prefixed). Used as the default refund address.
	From() string
	// Allowance returns the ERC-20 allowance granted by `owner` to
	// `spender` on `token`.
	Allowance(ctx context.Context, token, owner, spender string) (*big.Int, error)
	// Approve broadcasts an ERC-20 approve(spender, amount) tx on
	// `token` and returns the transaction hash.
	Approve(ctx context.Context, token, spender string, amount *big.Int) (string, error)
	// CreateOrder broadcasts a Gateway.createOrder tx with the given
	// arguments and returns the transaction hash. Implementations must
	// ABI-encode the call using GatewayABI.
	CreateOrder(ctx context.Context, gateway string, args GatewayCreateOrderArgs) (string, error)
}

// GatewayCreateOrderArgs mirrors the Gateway.createOrder solidity
// signature — the transactor adapts these into ABI-encoded calldata.
type GatewayCreateOrderArgs struct {
	Token              string
	Amount             *big.Int
	Rate               *big.Int // uint96
	SenderFeeRecipient string
	SenderFee          *big.Int
	RefundAddress      string
	MessageHash        string // base64 encrypted envelope
}

// GatewayPathConfig wires the caller's transactor + optional overrides
// for the on-chain off-ramp path. Constructed via ClientOptions.Gateway.
type GatewayPathConfig struct {
	Transactor          GatewayTransactor
	AggregatorPublicKey string
}

// GatewayOrderResult is returned when CreateOfframpOrder is dispatched
// with OfframpMethodGateway.
type GatewayOrderResult struct {
	TxHash         string
	ApproveTxHash  string
	GatewayAddress string
	TokenAddress   string
	Amount         *big.Int
	Rate           string
	MessageHash    string
	RefundAddress  string
	Network        string
}

type gatewayClient struct {
	registry *aggregatorRegistry
	config   *GatewayPathConfig
}

func newGatewayClient(registry *aggregatorRegistry, config *GatewayPathConfig) (*gatewayClient, error) {
	if config == nil || config.Transactor == nil {
		return nil, fmt.Errorf("GatewayPathConfig.Transactor is required")
	}
	return &gatewayClient{registry: registry, config: config}, nil
}

func (g *gatewayClient) createOfframpOrder(
	ctx context.Context,
	payload OfframpOrderPayload,
	rateResolver func(ctx context.Context, network, token, amount, fiat string) (string, error),
) (*GatewayOrderResult, error) {
	network, err := GetNetwork(payload.Source.Network)
	if err != nil {
		return nil, err
	}

	chainID, err := g.config.Transactor.ChainID(ctx)
	if err == nil && chainID != nil && chainID.Int64() != network.ChainID {
		return nil, fmt.Errorf("transactor chainId=%d does not match network %q (chainId=%d)",
			chainID.Int64(), network.Slug, network.ChainID)
	}

	token, err := g.registry.getToken(ctx, network.Slug, payload.Source.Currency)
	if err != nil {
		return nil, err
	}

	rate := payload.Rate
	if rate == "" {
		rate, err = rateResolver(ctx, network.Slug, payload.Source.Currency, payload.Amount, payload.Destination.Currency)
		if err != nil {
			return nil, err
		}
	}

	recipient, err := BuildRecipientPayload(
		payload.Destination.Recipient.Institution,
		payload.Destination.Recipient.AccountIdentifier,
		payload.Destination.Recipient.AccountName,
		payload.Destination.Recipient.Memo,
		payload.Destination.ProviderID,
		nil,
	)
	if err != nil {
		return nil, err
	}
	publicKey, err := g.registry.getPublicKey(ctx)
	if err != nil {
		return nil, err
	}
	messageHash, err := EncryptRecipientPayload(recipient, publicKey)
	if err != nil {
		return nil, err
	}

	amountSub, err := ToSubunits(payload.Amount, token.Decimals)
	if err != nil {
		return nil, err
	}
	feeSub := big.NewInt(0)
	if payload.SenderFee != "" {
		feeSub, err = ToSubunits(payload.SenderFee, token.Decimals)
		if err != nil {
			return nil, err
		}
	}
	rateUint96, err := ScaleRate(rate)
	if err != nil {
		return nil, err
	}

	refundAddr := g.config.Transactor.From()
	if payload.Source.RefundAddress != "" {
		refundAddr = payload.Source.RefundAddress
	}
	senderFeeRecipient := payload.SenderFeeRecipient
	if senderFeeRecipient == "" {
		senderFeeRecipient = "0x0000000000000000000000000000000000000000"
	}

	// 1) Approve gateway if current allowance is insufficient.
	needed := new(big.Int).Add(amountSub, feeSub)
	var approveHash string
	if needed.Sign() > 0 {
		current, err := g.config.Transactor.Allowance(ctx, token.ContractAddress, g.config.Transactor.From(), network.Gateway)
		if err != nil {
			return nil, fmt.Errorf("read allowance: %w", err)
		}
		if current.Cmp(needed) < 0 {
			approveHash, err = g.config.Transactor.Approve(ctx, token.ContractAddress, network.Gateway, needed)
			if err != nil {
				return nil, fmt.Errorf("approve: %w", err)
			}
		}
	}

	// 2) Gateway.createOrder
	createHash, err := g.config.Transactor.CreateOrder(ctx, network.Gateway, GatewayCreateOrderArgs{
		Token:              token.ContractAddress,
		Amount:             amountSub,
		Rate:               rateUint96,
		SenderFeeRecipient: senderFeeRecipient,
		SenderFee:          feeSub,
		RefundAddress:      refundAddr,
		MessageHash:        messageHash,
	})
	if err != nil {
		return nil, fmt.Errorf("createOrder: %w", err)
	}

	return &GatewayOrderResult{
		TxHash:         createHash,
		ApproveTxHash:  approveHash,
		GatewayAddress: network.Gateway,
		TokenAddress:   token.ContractAddress,
		Amount:         amountSub,
		Rate:           rate,
		MessageHash:    messageHash,
		RefundAddress:  refundAddr,
		Network:        network.Slug,
	}, nil
}

var decimalRegex = regexp.MustCompile(`^\d+(\.\d+)?$`)

// ToSubunits converts a positive decimal string amount into integer
// base units (e.g. "1.5" with decimals=6 -> 1_500_000).
func ToSubunits(amount string, decimals int) (*big.Int, error) {
	trimmed := strings.TrimSpace(amount)
	if trimmed == "" {
		return nil, fmt.Errorf("empty amount")
	}
	if !decimalRegex.MatchString(trimmed) {
		return nil, fmt.Errorf("invalid amount %q; expected positive decimal", amount)
	}
	parts := strings.SplitN(trimmed, ".", 2)
	whole := parts[0]
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > decimals {
		return nil, fmt.Errorf("amount %q has more fractional digits than token decimals (%d)", amount, decimals)
	}
	fraction = fraction + strings.Repeat("0", decimals-len(fraction))
	out, ok := new(big.Int).SetString(whole+fraction, 10)
	if !ok {
		return nil, fmt.Errorf("invalid integer conversion for %q", amount)
	}
	return out, nil
}

// ScaleRate converts a decimal-string rate to the uint96 representation
// the Gateway contract expects (rate * 100 rounded to nearest).
func ScaleRate(rate string) (*big.Int, error) {
	trimmed := strings.TrimSpace(rate)
	if !decimalRegex.MatchString(trimmed) {
		return nil, fmt.Errorf("invalid rate %q", rate)
	}
	parts := strings.SplitN(trimmed, ".", 2)
	whole := parts[0]
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) <= 2 {
		fraction = fraction + strings.Repeat("0", 2-len(fraction))
		out, ok := new(big.Int).SetString(whole+fraction, 10)
		if !ok {
			return nil, fmt.Errorf("invalid rate integer conversion for %q", rate)
		}
		return out, nil
	}
	shifted := whole + fraction[:2]
	out, ok := new(big.Int).SetString(shifted, 10)
	if !ok {
		return nil, fmt.Errorf("invalid rate integer conversion for %q", rate)
	}
	if fraction[2]-'0' >= 5 {
		out = out.Add(out, big.NewInt(1))
	}
	return out, nil
}
