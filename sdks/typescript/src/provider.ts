import { HttpClient } from "./http.js";
import {
  ListOrdersResponse,
  MarketRateResponse,
  PaymentOrder,
  ProviderListOrdersQuery,
  ProviderStats,
} from "./types.js";

export class ProviderClient {
  constructor(private readonly http: HttpClient) {}

  public async listOrders(query: ProviderListOrdersQuery): Promise<ListOrdersResponse> {
    const response = await this.http.request<ListOrdersResponse>({
      method: "GET",
      path: "/provider/orders",
      query: query as Record<string, string | number | boolean | undefined>,
    });
    return response.data;
  }

  public async getOrder(orderId: string): Promise<PaymentOrder> {
    const response = await this.http.request<PaymentOrder>({
      method: "GET",
      path: `/provider/orders/${orderId}`,
    });
    return response.data;
  }

  public async getStats(currency?: string): Promise<ProviderStats> {
    const response = await this.http.request<ProviderStats>({
      method: "GET",
      path: "/provider/stats",
      query: { currency },
    });
    return response.data;
  }

  public async getNodeInfo(): Promise<Record<string, unknown>> {
    const response = await this.http.request<Record<string, unknown>>({
      method: "GET",
      path: "/provider/node-info",
    });
    return response.data;
  }

  public async getMarketRate(token: string, fiat: string): Promise<MarketRateResponse> {
    const response = await this.http.request<MarketRateResponse>({
      method: "GET",
      path: `/provider/rates/${token}/${fiat}`,
    });
    return response.data;
  }
}
