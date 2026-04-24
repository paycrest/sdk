import { GatewayClient } from "./gateway-client.js";
import { HttpClient, PaycrestApiError } from "./http.js";
import {
  CreateOfframpOrderOptions,
  CreateOfframpOrderRequest,
  CreateOnrampOrderRequest,
  CreateOrderRequest,
  GatewayOrderResult,
  ListOrdersQuery,
  ListOrdersResponse,
  PaymentOrder,
  QuoteSide,
  RateQuoteResponse,
  SenderStats,
  VerifyAccountRequest,
} from "./types.js";

export class SenderClient {
  constructor(
    private readonly http: HttpClient,
    private readonly gatewayClient?: GatewayClient,
  ) {}

  private isOfframpOrder(payload: CreateOrderRequest): payload is CreateOfframpOrderRequest {
    return payload.source.type === "crypto" && payload.destination.type === "fiat";
  }

  private isOnrampOrder(payload: CreateOrderRequest): payload is CreateOnrampOrderRequest {
    return payload.source.type === "fiat" && payload.destination.type === "crypto";
  }

  public async createOrder(payload: CreateOrderRequest): Promise<PaymentOrder> {
    if (this.isOfframpOrder(payload)) {
      return this.createOfframpOrder(payload);
    }
    if (this.isOnrampOrder(payload)) {
      return this.createOnrampOrder(payload);
    }

    throw new PaycrestApiError(
      "Invalid sender order direction. Expected crypto->fiat (offramp) or fiat->crypto (onramp).",
      400,
    );
  }

  /**
   * Create an off-ramp order.
   *
   * @param payload  Same shape regardless of dispatch method.
   * @param options  `{ method: 'api' | 'gateway' }`. Defaults to `'api'`.
   *                 - `'api'`: aggregator provisions a receive address;
   *                   resolves to a `PaymentOrder` envelope.
   *                 - `'gateway'`: SDK encrypts recipient details with the
   *                   aggregator's RSA pubkey, ensures ERC-20 allowance,
   *                   and calls `Gateway.createOrder` from the configured
   *                   viem signer. Resolves to a `GatewayOrderResult`
   *                   carrying transaction hashes + chain metadata.
   */
  public async createOfframpOrder(
    payload: CreateOfframpOrderRequest,
    options?: CreateOfframpOrderOptions & { method?: "api" },
  ): Promise<PaymentOrder>;
  public async createOfframpOrder(
    payload: CreateOfframpOrderRequest,
    options: CreateOfframpOrderOptions & { method: "gateway" },
  ): Promise<GatewayOrderResult>;
  public async createOfframpOrder(
    payload: CreateOfframpOrderRequest,
    options?: CreateOfframpOrderOptions,
  ): Promise<PaymentOrder | GatewayOrderResult> {
    const method = options?.method ?? "api";
    if (method === "gateway") {
      if (!this.gatewayClient) {
        throw new PaycrestApiError(
          "Gateway dispatch is not configured. Pass `gateway: { signer, publicClient }` to createPaycrestClient.",
          400,
        );
      }
      return this.gatewayClient.createOfframpOrder(payload);
    }

    const preparedPayload = await this.withResolvedRate(payload, {
      network: payload.source.network,
      token: payload.source.currency,
      amount: payload.amount,
      fiat: payload.destination.currency,
      side: "sell",
    });

    const response = await this.http.request<PaymentOrder>({
      method: "POST",
      path: "/sender/orders",
      body: preparedPayload,
    });
    return response.data;
  }

  public async createOnrampOrder(payload: CreateOnrampOrderRequest): Promise<PaymentOrder> {
    const preparedPayload = await this.withResolvedRate(payload, {
      network: payload.destination.recipient.network,
      token: payload.destination.currency,
      amount: payload.amount,
      fiat: payload.source.currency,
      side: "buy",
    });

    const response = await this.http.request<PaymentOrder>({
      method: "POST",
      path: "/sender/orders",
      body: preparedPayload,
    });
    return response.data;
  }

  public async listOrders(query: ListOrdersQuery = {}): Promise<ListOrdersResponse> {
    const response = await this.http.request<ListOrdersResponse>({
      method: "GET",
      path: "/sender/orders",
      query: query as Record<string, string | number | boolean | undefined>,
    });
    return response.data;
  }

  public async getOrder(orderId: string): Promise<PaymentOrder> {
    const response = await this.http.request<PaymentOrder>({
      method: "GET",
      path: `/sender/orders/${orderId}`,
    });
    return response.data;
  }

  public async getStats(): Promise<SenderStats> {
    const response = await this.http.request<SenderStats>({
      method: "GET",
      path: "/sender/stats",
    });
    return response.data;
  }

  public async verifyAccount(payload: VerifyAccountRequest): Promise<string> {
    const response = await this.http.request<string>({
      method: "POST",
      path: "/verify-account",
      body: payload,
    });
    return response.data;
  }

  public async getTokenRate(input: {
    network: string;
    token: string;
    amount: string;
    fiat: string;
    side?: QuoteSide;
    providerId?: string;
  }): Promise<RateQuoteResponse> {
    const response = await this.http.request<RateQuoteResponse>({
      method: "GET",
      path: `/rates/${input.network}/${input.token}/${input.amount}/${input.fiat}`,
      query: {
        side: input.side,
        provider_id: input.providerId,
      },
    });
    return response.data;
  }

  private async withResolvedRate<T extends CreateOrderRequest>(
    payload: T,
    rateInput: {
      network: string;
      token: string;
      amount: string;
      fiat: string;
      side: QuoteSide;
    },
  ): Promise<T> {
    if (payload.rate) {
      return payload;
    }

    const quote = await this.getTokenRate(rateInput);
    const sideQuote = quote[rateInput.side];
    if (!sideQuote?.rate) {
      throw new PaycrestApiError(
        `Unable to fetch ${rateInput.side} rate for requested order.`,
        404,
        quote,
      );
    }

    return {
      ...payload,
      rate: sideQuote.rate,
    };
  }
}
