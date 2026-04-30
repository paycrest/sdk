import { randomUUID } from "node:crypto";

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
  CreateOnrampOrderOptions,
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

    const preparedPayload = ensureReference(
      await this.withResolvedRate(payload, {
        network: payload.source.network,
        token: payload.source.currency,
        amount: payload.amount,
        fiat: payload.destination.currency,
        side: "sell",
      }),
    );

    const response = await this.http.request<PaymentOrder>({
      method: "POST",
      path: "/sender/orders",
      body: preparedPayload,
      idempotencyKey: options?.idempotencyKey,
    });
    return response.data;
  }

  public async createOnrampOrder(
    payload: CreateOnrampOrderRequest,
    options?: CreateOnrampOrderOptions,
  ): Promise<PaymentOrder> {
    const preparedPayload = ensureReference(
      await this.withResolvedRate(payload, {
        network: payload.destination.recipient.network,
        token: payload.destination.currency,
        amount: payload.amount,
        fiat: payload.source.currency,
        side: "buy",
      }),
    );

    const response = await this.http.request<PaymentOrder>({
      method: "POST",
      path: "/sender/orders",
      body: preparedPayload,
      idempotencyKey: options?.idempotencyKey,
    });
    return response.data;
  }

  /**
   * Async generator that yields each order across every page. Use
   * instead of manual page-walking loops.
   *
   * ```ts
   * for await (const order of client.sender().iterateOrders({ status: "settled" })) {
   *   // process each one
   * }
   * ```
   *
   * Stops automatically when the current page comes back empty or when
   * the cumulative yielded count reaches the server-reported `total`.
   * Override the starting page with `query.page` (defaults to 1).
   */
  public async *iterateOrders(query: ListOrdersQuery = {}): AsyncGenerator<PaymentOrder> {
    const pageSize = query.pageSize ?? 50;
    let page = query.page ?? 1;
    let yielded = 0;
    while (true) {
      const response = await this.listOrders({ ...query, page, pageSize });
      if (!response.orders?.length) {
        return;
      }
      for (const order of response.orders) {
        yielded += 1;
        yield order;
      }
      if (response.total > 0 && yielded >= response.total) {
        return;
      }
      page += 1;
    }
  }

  /**
   * Convenience wrapper that collects all pages into an array. Use
   * `iterateOrders` for streaming / memory-sensitive workloads.
   */
  public async listAllOrders(query: ListOrdersQuery = {}): Promise<PaymentOrder[]> {
    const out: PaymentOrder[] = [];
    for await (const order of this.iterateOrders(query)) {
      out.push(order);
    }
    return out;
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
    const signal = opts.signal;

    let last: PaymentOrder | undefined;
    while (true) {
      if (signal?.aborted) {
        throw new PaycrestApiError(
          `waitForStatus aborted by caller; last status=${last?.status ?? "unknown"}`,
          499,
          last ?? undefined,
        );
      }
      const response = await this.http.request<PaymentOrder>({
        method: "GET",
        path: `/sender/orders/${orderId}`,
        signal,
      });
      const current: PaymentOrder = response.data;
      last = current;
      if (matchesTarget(current.status, target)) return current;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new PaycrestApiError(
          `Timed out waiting for order ${orderId} to reach ${describeTarget(target)}; last status=${current.status}`,
          408,
          current,
        );
      }
      await sleepOrAbort(Math.min(pollMs, remaining), signal);
    }
  }
}

/**
 * Auto-generate a reference on order payloads when the caller didn't
 * provide one. Keeping reference stable is the current dedup lever
 * users have — if a POST fails ambiguously, resubmitting with the same
 * reference lets the aggregator's bookkeeping match.
 */
/**
 * setTimeout-based sleep that unwinds early when the signal aborts.
 * Rejects with a PaycrestApiError so callers can distinguish timeouts
 * from aborts in a single catch block.
 */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PaycrestApiError("waitForStatus aborted by caller", 499));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new PaycrestApiError("waitForStatus aborted by caller", 499));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function ensureReference<T extends { reference?: string }>(payload: T): T {
  if (payload.reference && payload.reference.length > 0) {
    return payload;
  }
  return { ...payload, reference: randomUUID() };
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
