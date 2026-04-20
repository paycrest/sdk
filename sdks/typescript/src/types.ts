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
  reference?: string;
}

export type CreateOfframpOrderRequest = BaseCreateOrderRequest & {
  source: CryptoSource;
  destination: FiatDestination;
};

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
}
