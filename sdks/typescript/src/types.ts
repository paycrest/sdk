export type OrderStatus =
  | "initiated"
  | "deposited"
  | "pending"
  | "fulfilling"
  | "fulfilled"
  | "validated"
  | "settling"
  | "settled"
  | "cancelled"
  | "refunding"
  | "refunded"
  | "expired";

export type QuoteSide = "buy" | "sell";

export interface ApiResponse<T> {
  status: string;
  message?: string;
  data: T;
}

export interface VerifyAccountRequest {
  institution: string;
  accountIdentifier: string;
}

export interface SenderStats {
  totalOrders: number;
  totalOrderVolume: string;
  totalFeeEarnings: string;
}

export interface ProviderStats {
  totalOrders: number;
  totalFiatVolume: string;
  totalCryptoVolume: string;
}

export interface FiatRecipient {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo: string;
}

export interface FiatRefundAccount {
  institution: string;
  accountIdentifier: string;
  accountName: string;
}

export interface CryptoRecipient {
  address: string;
  network: string;
}

export interface CryptoSource {
  type: "crypto";
  currency: string;
  network: string;
  refundAddress: string;
}

export interface FiatSource {
  type: "fiat";
  currency: string;
  country?: string;
  refundAccount: FiatRefundAccount;
}

export interface FiatDestination {
  type: "fiat";
  currency: string;
  country?: string;
  providerId?: string;
  recipient: FiatRecipient;
}

export interface CryptoDestination {
  type: "crypto";
  currency: string;
  providerId?: string;
  recipient: CryptoRecipient;
}

export interface BaseCreateOrderRequest {
  amount: string;
  amountIn?: "crypto" | "fiat";
  rate?: string;
  senderFee?: string;
  senderFeePercent?: string;
  /** Required when `method === 'gateway'` and `senderFee > 0`. */
  senderFeeRecipient?: string;
  reference?: string;
}

export type CreateOfframpOrderRequest = BaseCreateOrderRequest & {
  source: CryptoSource;
  destination: FiatDestination;
};

/**
 * Off-ramp dispatch method.
 *
 * - `api` (default): aggregator-managed; SDK calls `POST /sender/orders`
 *   and the aggregator provisions a receive address.
 * - `gateway`: direct on-chain Gateway contract call from the sender's
 *   wallet (bypasses the aggregator API). Requires `gateway.signer` and
 *   `gateway.publicClient` to be configured on the client.
 */
export type OfframpMethod = "api" | "gateway";

export interface CreateOfframpOrderOptions {
  method?: OfframpMethod;
}

export interface GatewayOrderResult {
  /** `Gateway.createOrder` transaction hash. */
  txHash: string;
  /** ERC-20 approve transaction hash, if one was sent. */
  approveTxHash?: string;
  gatewayAddress: string;
  tokenAddress: string;
  /** Amount in token base units (string-encoded BigInt). */
  amount: string;
  /** Rate used (decimal string, before uint96 scaling). */
  rate: string;
  /** Base64 envelope passed as the contract `messageHash` argument. */
  messageHash: string;
  refundAddress: string;
  network: string;
}

/**
 * Internal handle wiring viem signer + RPC + aggregator HTTP into the
 * gateway client. Only `signer` and `publicClient` are user-supplied.
 */
export interface GatewayPath {
  // Use `unknown` to avoid forcing viem types on consumers who only
  // need the api method. The runtime check happens in GatewayClient.
  signer: any; // viem WalletClient
  publicClient: any; // viem PublicClient
  aggregatorHttp: import("./http.js").HttpClient;
}

export type CreateOnrampOrderRequest = BaseCreateOrderRequest & {
  source: FiatSource;
  destination: CryptoDestination;
};

export type CreateOrderRequest = CreateOfframpOrderRequest | CreateOnrampOrderRequest;

export interface ProviderAccount {
  network?: string;
  receiveAddress?: string;
  institution?: string;
  accountIdentifier?: string;
  accountName?: string;
  amountToTransfer?: string;
  currency?: string;
  validUntil?: string;
}

export interface PaymentOrder {
  id: string;
  status: OrderStatus;
  direction?: "offramp" | "onramp";
  orderType?: "regular" | "otc";
  createdAt?: string;
  updatedAt?: string;
  amount?: string;
  amountInUsd?: string;
  amountPaid?: string;
  amountReturned?: string;
  percentSettled?: string;
  rate?: string;
  senderFee?: string;
  senderFeePercent?: string;
  transactionFee?: string;
  reference?: string;
  txHash?: string;
  providerAccount?: ProviderAccount;
  source?: CryptoSource | FiatSource;
  destination?: FiatDestination | CryptoDestination;
}

export interface ListOrdersResponse {
  total: number;
  page: number;
  pageSize: number;
  orders: PaymentOrder[];
}

export interface ListOrdersQuery {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
}

/** Target for {@link SenderClient.waitForStatus}. */
export type WaitStatusTarget = OrderStatus | OrderStatus[] | "terminal";

export interface WaitForStatusOptions {
  /** Poll interval in milliseconds. Default: 3000. */
  pollMs?: number;
  /** Overall timeout in milliseconds. Default: 300000 (5 min). */
  timeoutMs?: number;
}

export interface ProviderListOrdersQuery extends ListOrdersQuery {
  currency: string;
  ordering?: "asc" | "desc";
  search?: string;
  export?: "csv";
  from?: string;
  to?: string;
}

export interface RateQuoteSide {
  rate: string;
  providerIds: string[];
  orderType: string;
  refundTimeoutMinutes: number;
}

export interface RateQuoteResponse {
  buy?: RateQuoteSide;
  sell?: RateQuoteSide;
}

export interface MarketRateSide {
  marketRate: string;
  minimumRate: string;
  maximumRate: string;
}

export interface MarketRateResponse {
  buy?: MarketRateSide;
  sell?: MarketRateSide;
}

export interface PaycrestClientOptions {
  apiKey?: string;
  senderApiKey?: string;
  providerApiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  /**
   * Required only when calling `createOfframpOrder(payload, { method: 'gateway' })`.
   * `signer` is a viem `WalletClient` with an `account`; `publicClient` is a viem
   * `PublicClient` for the same chain. Optional override for the aggregator's RSA
   * public key (PEM); defaults to fetching from `GET /v2/pubkey`.
   */
  gateway?: {
    signer: any;
    publicClient: any;
    aggregatorPublicKey?: string;
  };
}
