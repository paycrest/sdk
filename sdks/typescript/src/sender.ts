import { HttpClient } from "./http.js";
import {
  CreateOrderRequest,
  ListOrdersQuery,
  ListOrdersResponse,
  PaymentOrder,
  SenderStats,
  VerifyAccountRequest,
} from "./types.js";

export class SenderClient {
  constructor(private readonly http: HttpClient) {}

  public async createOrder(payload: CreateOrderRequest): Promise<PaymentOrder> {
    const response = await this.http.request<PaymentOrder>({
      method: "POST",
      path: "/sender/orders",
      body: payload,
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
}
