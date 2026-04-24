package sdk

import (
	"encoding/json"
	"fmt"
	"math/big"
	"sync"
)

// GatewayABI is the minimal Paycrest Gateway ABI covering createOrder,
// getOrderInfo, and OrderCreated. It is returned as a JSON string so
// callers can load it into go-ethereum's accounts/abi package (or any
// other web3 client) without this SDK taking on a heavy dependency.
const GatewayABI = `[
  {
    "type": "function",
    "name": "createOrder",
    "stateMutability": "nonpayable",
    "inputs": [
      {"name": "_token", "type": "address"},
      {"name": "_amount", "type": "uint256"},
      {"name": "_rate", "type": "uint96"},
      {"name": "_senderFeeRecipient", "type": "address"},
      {"name": "_senderFee", "type": "uint256"},
      {"name": "_refundAddress", "type": "address"},
      {"name": "messageHash", "type": "string"}
    ],
    "outputs": [{"name": "orderId", "type": "bytes32"}]
  },
  {
    "type": "function",
    "name": "getOrderInfo",
    "stateMutability": "view",
    "inputs": [{"name": "_orderId", "type": "bytes32"}],
    "outputs": [{
      "name": "",
      "type": "tuple",
      "components": [
        {"name": "sender", "type": "address"},
        {"name": "token", "type": "address"},
        {"name": "senderFeeRecipient", "type": "address"},
        {"name": "senderFee", "type": "uint256"},
        {"name": "protocolFee", "type": "uint256"},
        {"name": "isFulfilled", "type": "bool"},
        {"name": "isRefunded", "type": "bool"},
        {"name": "refundAddress", "type": "address"},
        {"name": "currentBPS", "type": "uint96"},
        {"name": "amount", "type": "uint256"}
      ]
    }]
  },
  {
    "type": "event",
    "name": "OrderCreated",
    "inputs": [
      {"indexed": true, "name": "sender", "type": "address"},
      {"indexed": true, "name": "token", "type": "address"},
      {"indexed": false, "name": "amount", "type": "uint256"},
      {"indexed": false, "name": "protocolFee", "type": "uint256"},
      {"indexed": true, "name": "orderId", "type": "bytes32"},
      {"indexed": false, "name": "rate", "type": "uint96"},
      {"indexed": false, "name": "messageHash", "type": "string"}
    ]
  }
]`

var (
	gatewayAddressMu sync.RWMutex
	gatewayAddresses = map[string]string{}
)

// RegisterGatewayAddress records the Gateway contract address for a network
// slug. Authoritative addresses live in Paycrest docs.
func RegisterGatewayAddress(network, address string) {
	gatewayAddressMu.Lock()
	defer gatewayAddressMu.Unlock()
	gatewayAddresses[network] = address
}

// GatewayAddressFor returns the registered Gateway address for a network
// slug, or empty string if none was registered.
func GatewayAddressFor(network string) string {
	gatewayAddressMu.RLock()
	defer gatewayAddressMu.RUnlock()
	return gatewayAddresses[network]
}

// GatewayCreateOrderParams mirrors the Paycrest Gateway.createOrder signature.
type GatewayCreateOrderParams struct {
	Token              string
	Amount             *big.Int
	Rate               *big.Int
	SenderFeeRecipient string
	SenderFee          *big.Int
	RefundAddress      string
	MessageHash        string
}

// GatewayTxRequest is a web3-library-agnostic call descriptor. Callers feed
// it to go-ethereum, ethers-go, or any compatible signer.
type GatewayTxRequest struct {
	To           string
	ABI          string
	FunctionName string
	Args         []interface{}
	Value        string
}

// Gateway targets a specific Paycrest Gateway deployment.
type Gateway struct {
	Address string
	Network string
}

// NewGateway returns a Gateway for an explicit contract address.
func NewGateway(address, network string) (*Gateway, error) {
	if address == "" {
		return nil, fmt.Errorf("gateway contract address is required")
	}
	return &Gateway{Address: address, Network: network}, nil
}

// GatewayForNetwork resolves a Gateway for a registered network slug,
// with an optional address override.
func GatewayForNetwork(network, addressOverride string) (*Gateway, error) {
	address := addressOverride
	if address == "" {
		address = GatewayAddressFor(network)
	}
	if address == "" {
		return nil, fmt.Errorf(
			"no Gateway address registered for network %q; pass an address explicitly or call RegisterGatewayAddress",
			network,
		)
	}
	return NewGateway(address, network)
}

// BuildCreateOrderCall returns the transaction descriptor for
// Gateway.createOrder. The caller signs and broadcasts.
func (g *Gateway) BuildCreateOrderCall(params GatewayCreateOrderParams) GatewayTxRequest {
	return GatewayTxRequest{
		To:           g.Address,
		ABI:          GatewayABI,
		FunctionName: "createOrder",
		Args: []interface{}{
			params.Token,
			params.Amount,
			params.Rate,
			params.SenderFeeRecipient,
			params.SenderFee,
			params.RefundAddress,
			params.MessageHash,
		},
		Value: "0",
	}
}

// BuildGetOrderInfoCall returns the read call descriptor for Gateway.getOrderInfo.
func (g *Gateway) BuildGetOrderInfoCall(orderID string) GatewayTxRequest {
	return GatewayTxRequest{
		To:           g.Address,
		ABI:          GatewayABI,
		FunctionName: "getOrderInfo",
		Args:         []interface{}{orderID},
		Value:        "0",
	}
}

// ValidateABI ensures the bundled ABI string is well-formed JSON.
// Handy smoke check so accidental edits surface in tests.
func ValidateABI() error {
	var parsed []map[string]interface{}
	return json.Unmarshal([]byte(GatewayABI), &parsed)
}
