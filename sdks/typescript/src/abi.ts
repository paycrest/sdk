/**
 * Minimal Paycrest Gateway ABI fragments needed by the SDK's direct
 * contract path. Verified against `paycrest/noblocks` `app/api/abi.ts`
 * and `paycrest/aggregator` `services/contracts/Gateway.go`.
 */
export const GATEWAY_ABI = [
  {
    type: "function",
    name: "createOrder",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "address", name: "_token", type: "address" },
      { internalType: "uint256", name: "_amount", type: "uint256" },
      { internalType: "uint96", name: "_rate", type: "uint96" },
      { internalType: "address", name: "_senderFeeRecipient", type: "address" },
      { internalType: "uint256", name: "_senderFee", type: "uint256" },
      { internalType: "address", name: "_refundAddress", type: "address" },
      { internalType: "string", name: "messageHash", type: "string" },
    ],
    outputs: [{ internalType: "bytes32", name: "orderId", type: "bytes32" }],
  },
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { indexed: true, name: "sender", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "amount", type: "uint256" },
      { indexed: false, name: "protocolFee", type: "uint256" },
      { indexed: false, name: "orderId", type: "bytes32" },
      { indexed: false, name: "rate", type: "uint256" },
      { indexed: false, name: "messageHash", type: "string" },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
