import type { Address, Hex, PublicClient, WalletClient } from "viem";

import { ERC20_ABI, GATEWAY_ABI } from "./abi.js";
import {
  buildRecipientPayload,
  encryptRecipientPayload,
} from "./encryption.js";
import { getNetwork } from "./networks.js";
import { AggregatorRegistry } from "./registry.js";
import type {
  CreateOfframpOrderRequest,
  GatewayOrderResult,
  GatewayPath,
} from "./types.js";

/**
 * Sender's gateway path: encrypts recipient details, ensures ERC-20
 * allowance, then calls Gateway.createOrder. Caller passes a viem
 * WalletClient (signer) and PublicClient (read RPC); the SDK handles
 * everything else under the hood.
 */
export class GatewayClient {
  constructor(
    private readonly registry: AggregatorRegistry,
    private readonly path: GatewayPath,
  ) {}

  public async createOfframpOrder(
    payload: CreateOfframpOrderRequest,
  ): Promise<GatewayOrderResult> {
    const walletClient = this.path.signer;
    const publicClient = this.path.publicClient;
    const account = walletClient.account;
    if (!account) {
      throw new Error(
        "viem WalletClient must be initialized with an account to use the gateway path",
      );
    }
    const senderAddress = account.address;

    // Resolve network + token metadata (chain id, gateway address, ERC-20).
    const network = getNetwork(payload.source.network);
    if (network.chainId !== walletClient.chain?.id && walletClient.chain?.id) {
      throw new Error(
        `Signer is on chainId ${walletClient.chain.id} but order targets "${network.slug}" (chainId ${network.chainId}).`,
      );
    }
    const token = await this.registry.getToken(
      network.slug,
      payload.source.currency,
    );

    // Resolve rate first if the caller didn't supply one — same path as
    // the api-method default. We do this without a SenderClient round
    // trip by calling /rates directly through the cached HttpClient.
    const rate = await this.resolveRate(payload, network.slug);

    // Encrypt recipient JSON with the aggregator's RSA pubkey.
    const recipient = payload.destination.recipient;
    const recipientPayload = buildRecipientPayload({
      institution: recipient.institution,
      accountIdentifier: recipient.accountIdentifier,
      accountName: recipient.accountName,
      memo: recipient.memo,
      providerId: payload.destination.providerId,
    });
    const publicKey = await this.registry.getPublicKey();
    const messageHash = encryptRecipientPayload(recipientPayload, publicKey);

    // Convert amount + senderFee to base units.
    const amountSubunits = toSubunits(payload.amount, token.decimals);
    const senderFeeSubunits = payload.senderFee
      ? toSubunits(payload.senderFee, token.decimals)
      : 0n;
    const rateUint96 = scaleRate(rate);

    // Refund address: explicit override > viem account address.
    const refundAddress = (payload.source.refundAddress ||
      senderAddress) as Address;

    // 1) Approve gateway to pull amount + fee from the sender.
    const approveTotal = amountSubunits + senderFeeSubunits;
    const approveHash = await this.ensureAllowance(
      publicClient,
      walletClient,
      token.contractAddress,
      network.gateway,
      senderAddress,
      approveTotal,
    );

    // 2) Call Gateway.createOrder.
    const senderFeeRecipient: Address =
      (payload.senderFeeRecipient as Address | undefined) ??
      ("0x0000000000000000000000000000000000000000" as Address);

    const txHash = (await walletClient.writeContract({
      address: network.gateway,
      abi: GATEWAY_ABI,
      functionName: "createOrder",
      args: [
        token.contractAddress,
        amountSubunits,
        rateUint96,
        senderFeeRecipient,
        senderFeeSubunits,
        refundAddress,
        messageHash,
      ],
      account,
      chain: walletClient.chain ?? null,
    } as Parameters<WalletClient["writeContract"]>[0])) as Hex;

    return {
      txHash,
      approveTxHash: approveHash,
      gatewayAddress: network.gateway,
      tokenAddress: token.contractAddress,
      amount: amountSubunits.toString(),
      rate,
      messageHash,
      refundAddress,
      network: network.slug,
    };
  }

  private async resolveRate(
    payload: CreateOfframpOrderRequest,
    network: string,
  ): Promise<string> {
    if (payload.rate) return payload.rate;
    const response = await this.path.aggregatorHttp.request<{
      sell?: { rate?: string };
    }>({
      method: "GET",
      path: `/rates/${network}/${payload.source.currency}/${payload.amount}/${payload.destination.currency}`,
      query: { side: "sell" },
    });
    const rate = response.data?.sell?.rate;
    if (!rate) {
      throw new Error(
        "Aggregator did not return a sell-side rate for this pair.",
      );
    }
    return rate;
  }

  private async ensureAllowance(
    publicClient: PublicClient,
    walletClient: WalletClient,
    token: Address,
    gateway: Address,
    owner: Address,
    needed: bigint,
  ): Promise<Hex | undefined> {
    if (needed === 0n) return undefined;

    const current = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, gateway],
    })) as bigint;

    if (current >= needed) return undefined;

    const account = walletClient.account!;
    return (await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [gateway, needed],
      account,
      chain: walletClient.chain ?? null,
    } as Parameters<WalletClient["writeContract"]>[0])) as Hex;
  }
}

/**
 * Convert a decimal-string amount (e.g. `"1.25"`) to integer subunits
 * (`125_000_000` for 8-decimal token). Mirrors the aggregator's
 * `utils.ToSubunit` using string math to avoid float rounding.
 */
export function toSubunits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount "${amount}" — expected a positive decimal string`);
  }
  const [whole, fractionRaw = ""] = trimmed.split(".");
  if (fractionRaw.length > decimals) {
    throw new Error(
      `Amount "${amount}" has more fractional digits than token decimals (${decimals})`,
    );
  }
  const fraction = fractionRaw.padEnd(decimals, "0");
  return BigInt(whole + fraction);
}

/**
 * Scale a decimal-string rate to the uint96 representation the Gateway
 * contract expects. Aggregator uses `rate * 100` rounded half-to-even.
 */
export function scaleRate(rate: string): bigint {
  const numeric = Number(rate);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid rate "${rate}"`);
  }
  return BigInt(Math.round(numeric * 100));
}
