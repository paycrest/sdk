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

export interface CreateOrderRequest {
  amount: string;
  amountIn?: "crypto" | "fiat";
  rate?: string;
  senderFee?: string;
  senderFeePercent?: string;
  reference?: string;
  source: CryptoSource | FiatSource;
  destination: FiatDestination | CryptoDestination;
}

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

export interface PaycrestClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}
