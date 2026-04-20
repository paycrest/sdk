import { HttpClient, PaycrestApiError } from "./http.js";
import {
  CreateOfframpOrderRequest,
  CreateOnrampOrderRequest,
  CreateOrderRequest,
  ListOrdersQuery,
  ListOrdersResponse,
  PaymentOrder,
  QuoteSide,
  RateQuoteResponse,
  SenderStats,
  VerifyAccountRequest,
} from "./types.js";

export class SenderClient {
  constructor(private readonly http: HttpClient) {}

  public async createOrder(payload: CreateOrderRequest): Promise<PaymentOrder> {
    if (payload.source.type === "crypto" && payload.destination.type === "fiat") {
      return this.createOfframpOrder(payload);
    }
    if (payload.source.type === "fiat" && payload.destination.type === "crypto") {
      return this.createOnrampOrder(payload);
    }

    throw new PaycrestApiError(
      "Invalid sender order direction. Expected crypto->fiat (offramp) or fiat->crypto (onramp).",
      400,
    );
  }

  public async createOfframpOrder(payload: CreateOfframpOrderRequest): Promise<PaymentOrder> {
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
