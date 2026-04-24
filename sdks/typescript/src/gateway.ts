/**
 * Direct-contract off-ramp path.
 *
 * Lets integrators bypass the aggregator API and call the Paycrest Gateway
 * contract themselves (same pattern noblocks uses). The SDK stays web3-
 * library-agnostic: it produces the contract address, function name, ABI,
 * and argument tuple so callers can hand them to viem / ethers / wagmi /
 * any other signer they already use.
 */

export const GATEWAY_ABI = [
  {
    type: "function",
    name: "createOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_token", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_rate", type: "uint96" },
      { name: "_senderFeeRecipient", type: "address" },
      { name: "_senderFee", type: "uint256" },
      { name: "_refundAddress", type: "address" },
      { name: "messageHash", type: "string" },
    ],
    outputs: [{ name: "orderId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getOrderInfo",
    stateMutability: "view",
    inputs: [{ name: "_orderId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "token", type: "address" },
          { name: "senderFeeRecipient", type: "address" },
          { name: "senderFee", type: "uint256" },
          { name: "protocolFee", type: "uint256" },
          { name: "isFulfilled", type: "bool" },
          { name: "isRefunded", type: "bool" },
          { name: "refundAddress", type: "address" },
          { name: "currentBPS", type: "uint96" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { indexed: true, name: "sender", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "protocolFee", type: "uint256" },
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "rate", type: "uint96" },
      { indexed: false, name: "messageHash", type: "string" },
    ],
  },
] as const;

export type GatewayAbi = typeof GATEWAY_ABI;

/**
 * Known Paycrest Gateway deployments keyed by canonical network slug.
 *
 * Addresses default to empty; populate via `Gateway.register` or pass an
 * explicit address per instance. Authoritative addresses live in the
 * Paycrest docs (https://docs.paycrest.io) and are chain-specific.
 */
export const GATEWAY_ADDRESSES: Record<string, string> = {};

export interface GatewayCreateOrderParams {
  token: string;
  amount: string | bigint;
  rate: string | bigint;
  senderFeeRecipient: string;
  senderFee: string | bigint;
  refundAddress: string;
  messageHash: string;
}

export interface GatewayTxRequest {
  to: string;
  abi: GatewayAbi;
  functionName: "createOrder" | "getOrderInfo";
  args: readonly unknown[];
  value: "0";
}

export class Gateway {
  public readonly address: string;
  public readonly network?: string;

  constructor(address: string, network?: string) {
    if (!address) {
      throw new Error("Gateway contract address is required");
    }
    this.address = address;
    this.network = network;
  }

  public static forNetwork(network: string, address?: string): Gateway {
    const resolved = address || GATEWAY_ADDRESSES[network];
    if (!resolved) {
      throw new Error(
        `No Gateway address registered for network "${network}". Pass an address explicitly or call Gateway.register().`,
      );
    }
    return new Gateway(resolved, network);
  }

  public static register(network: string, address: string): void {
    GATEWAY_ADDRESSES[network] = address;
  }

  public buildCreateOrderCall(params: GatewayCreateOrderParams): GatewayTxRequest {
    return {
      to: this.address,
      abi: GATEWAY_ABI,
      functionName: "createOrder",
      args: [
        params.token,
        BigInt(params.amount),
        BigInt(params.rate),
        params.senderFeeRecipient,
        BigInt(params.senderFee),
        params.refundAddress,
        params.messageHash,
      ],
      value: "0",
    };
  }

  public buildGetOrderInfoCall(orderId: string): GatewayTxRequest {
    return {
      to: this.address,
      abi: GATEWAY_ABI,
      functionName: "getOrderInfo",
      args: [orderId],
      value: "0",
    };
  }
}
