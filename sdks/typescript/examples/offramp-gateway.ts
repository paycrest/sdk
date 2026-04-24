/**
 * Off-ramp via the direct Gateway contract path (method: 'gateway').
 *
 * Same `createOfframpOrder` you'd use for the aggregator API — the only
 * difference is `{ method: 'gateway' }` plus a viem signer/publicClient
 * supplied at client construction. The SDK handles:
 *   - network + token metadata lookup (contract address, decimals)
 *   - /pubkey fetch + caching
 *   - RSA+AES-GCM recipient encryption (messageHash)
 *   - ERC-20 allowance check + approve when insufficient
 *   - Gateway.createOrder broadcast
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createPaycrestClient } from "../src/index.js";

async function main() {
  const account = privateKeyToAccount(process.env.SIGNER_PRIVATE_KEY! as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL!),
  });
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL!),
  });

  const client = createPaycrestClient({
    senderApiKey: process.env.PAYCREST_SENDER_API_KEY!, // kept for optional fallback calls
    gateway: { signer: walletClient, publicClient },
  });

  const result = await client.sender().createOfframpOrder(
    {
      amount: "100",
      source: {
        type: "crypto",
        currency: "USDT",
        network: "base",
        refundAddress: account.address,
      },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: {
          institution: "GTBINGLA",
          accountIdentifier: "1234567890",
          accountName: "Jane Doe",
          memo: "Payout",
        },
      },
    },
    { method: "gateway" },
  );

  console.log(result);
  // {
  //   txHash: '0x...',          // Gateway.createOrder
  //   approveTxHash: '0x...',   // ERC20.approve (undefined if allowance sufficient)
  //   gatewayAddress: '0x30f6a8457f8e42371e204a9c103f2bd42341dd0f',
  //   tokenAddress: '0x...',    // USDT on base
  //   amount: '100000000',      // base units
  //   rate: '1500',             // pre-scaling decimal string
  //   messageHash: 'b64...',    // encrypted recipient envelope
  //   refundAddress: '0x...',
  //   network: 'base',
  // }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
