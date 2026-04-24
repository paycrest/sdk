package sdk

// GatewayABI is the minimal Paycrest Gateway ABI the SDK needs to build
// calldata for `createOrder` and decode the `OrderCreated` event. It is
// JSON-encoded so callers can plug it directly into go-ethereum's
// `accounts/abi` package without taking on extra dependencies here.
const GatewayABI = `[
  {
    "type": "function",
    "name": "createOrder",
    "stateMutability": "nonpayable",
    "inputs": [
      {"internalType": "address", "name": "_token", "type": "address"},
      {"internalType": "uint256", "name": "_amount", "type": "uint256"},
      {"internalType": "uint96",  "name": "_rate",   "type": "uint96"},
      {"internalType": "address", "name": "_senderFeeRecipient", "type": "address"},
      {"internalType": "uint256", "name": "_senderFee", "type": "uint256"},
      {"internalType": "address", "name": "_refundAddress", "type": "address"},
      {"internalType": "string",  "name": "messageHash", "type": "string"}
    ],
    "outputs": [{"internalType": "bytes32", "name": "orderId", "type": "bytes32"}]
  },
  {
    "type": "event",
    "name": "OrderCreated",
    "inputs": [
      {"indexed": true,  "name": "sender",     "type": "address"},
      {"indexed": true,  "name": "token",      "type": "address"},
      {"indexed": true,  "name": "amount",     "type": "uint256"},
      {"indexed": false, "name": "protocolFee","type": "uint256"},
      {"indexed": false, "name": "orderId",    "type": "bytes32"},
      {"indexed": false, "name": "rate",       "type": "uint256"},
      {"indexed": false, "name": "messageHash","type": "string"}
    ]
  }
]`

// ERC20ABI covers the approve + allowance functions the SDK needs when
// ensuring the Gateway can pull tokens.
const ERC20ABI = `[
  {
    "type": "function",
    "name": "approve",
    "stateMutability": "nonpayable",
    "inputs": [
      {"name": "spender", "type": "address"},
      {"name": "amount",  "type": "uint256"}
    ],
    "outputs": [{"name": "", "type": "bool"}]
  },
  {
    "type": "function",
    "name": "allowance",
    "stateMutability": "view",
    "inputs": [
      {"name": "owner",   "type": "address"},
      {"name": "spender", "type": "address"}
    ],
    "outputs": [{"name": "", "type": "uint256"}]
  }
]`
