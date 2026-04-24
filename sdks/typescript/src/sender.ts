import {
  PaycrestApiError,
  RateQuoteUnavailableError,
  ValidationError,
} from "./errors.js";
import { GatewayClient } from "./gateway-client.js";
import { HttpClient } from "./http.js";
import {
  CreateOfframpOrderOptions,
  CreateOfframpOrderRequest,
  CreateOnrampOrderRequest,
  CreateOrderRequest,
  GatewayOrderResult,
  ListOrdersQuery,
  ListOrdersResponse,
  OrderStatus,
  PaymentOrder,
  QuoteSide,
  RateQuoteResponse,
  SenderStats,
  VerifyAccountRequest,
  WaitForStatusOptions,
  WaitStatusTarget,
} from "./types.js";

const TERMINAL_STATUSES = new Set<OrderStatus>([
  "settled",
  "refunded",
  "expired",
  "cancelled",
]);

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

    throw new ValidationError(
      "Invalid sender order direction. Expected crypto->fiat (offramp) or fiat->crypto (onramp).",
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
        throw new ValidationError(
          "Gateway dispatch is not configured. Pass `gateway: { signer, publicClient }` to createPaycrestClient.",
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
      throw new RateQuoteUnavailableError(
        `Unable to fetch ${rateInput.side} rate for requested order.`,
        quote,
      );
    }

    return {
      ...payload,
      rate: sideQuote.rate,
    };
  }

  /**
   * Poll `getOrder(orderId)` until the order reaches `target` or the
   * timeout expires.
   *
   * @param target  One of:
   *   - a specific {@link OrderStatus} (e.g. `"settled"`)
   *   - an array of statuses (stops when any matches)
   *   - the literal string `"terminal"` — stops on any terminal state
   *     (settled / refunded / expired / cancelled)
   *
   * Defaults: `pollMs = 3000`, `timeoutMs = 5 * 60 * 1000`.
   * Throws {@link PaycrestApiError} on timeout with the most recent order attached.
   */
  public async waitForStatus(
    orderId: string,
    target: WaitStatusTarget,
    opts: WaitForStatusOptions = {},
  ): Promise<PaymentOrder> {
    const pollMs = opts.pollMs ?? 3_000;
    const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;

    let last: PaymentOrder | undefined;
    while (true) {
      last = await this.getOrder(orderId);
      if (matchesTarget(last.status, target)) return last;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new PaycrestApiError(
          `Timed out waiting for order ${orderId} to reach ${describeTarget(target)}; last status=${last.status}`,
          408,
          last,
        );
      }
      await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
    }
  }
}

function matchesTarget(status: OrderStatus, target: WaitStatusTarget): boolean {
  if (target === "terminal") return TERMINAL_STATUSES.has(status);
  if (Array.isArray(target)) return target.includes(status);
  return status === target;
}

function describeTarget(target: WaitStatusTarget): string {
  if (target === "terminal") return "a terminal status";
  if (Array.isArray(target)) return target.join("|");
  return target;
}
