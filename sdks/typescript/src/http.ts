import {
  NetworkError,
  PaycrestApiError,
  RateLimitError,
  classifyHttpError,
} from "./errors.js";
import { ApiResponse } from "./types.js";

// Re-exported for backwards compatibility — existing callers may import
// PaycrestApiError from here.
export {
  AuthenticationError,
  NetworkError,
  NotFoundError,
  OrderRejectedError,
  PaycrestApiError,
  ProviderUnavailableError,
  RateLimitError,
  RateQuoteUnavailableError,
  ValidationError,
} from "./errors.js";

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Override retry policy per-call. Default: retry GETs only. */
  retry?: Partial<RetryPolicy>;
}

/**
 * Retry policy applied to HTTP requests.
 *
 * Default: retry GETs on transport errors + 429/500/502/503/504 with
 * exponential backoff + full jitter (capped at `maxDelayMs`). POSTs
 * retry **only** on transport errors that happen before the server
 * acknowledged the request (DNS, connection refused) — automatic retry
 * of acknowledged POST failures is unsafe for payment SDKs.
 */
export interface RetryPolicy {
  /** Total attempts including the first (so `retries: 3` = 1 initial + 2 retries). */
  retries: number;
  /** Initial backoff in ms; subsequent attempts use exponential backoff + jitter. */
  baseDelayMs: number;
  /** Cap on individual backoff wait. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    baseUrl: string,
    apiKey: string,
    timeoutMs: number,
    fetcher: typeof fetch,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
    this.retryPolicy = retryPolicy;
  }

  public async request<T>({ method, path, query, body, retry }: RequestOptions): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const policy = { ...this.retryPolicy, ...retry };
    let lastError: PaycrestApiError | undefined;

    for (let attempt = 1; attempt <= policy.retries; attempt++) {
      try {
        return await this.send<T>(url, method, body);
      } catch (err) {
        const typed = err instanceof PaycrestApiError ? err : new NetworkError("Unexpected transport error", err);
        lastError = typed;
        if (attempt >= policy.retries) break;

        // Transport errors are retried on any verb (the server never
        // saw us). Acknowledged server errors are retried only on
        // idempotent verbs — POSTs that got a server response might
        // have partially succeeded and we must not double-submit.
        const retryable = this.isRetryable(typed, method);
        if (!retryable) break;

        const delay = this.computeBackoff(attempt, typed, policy);
        await sleep(delay);
      }
    }

    throw lastError ?? new NetworkError("Unknown HTTP failure");
  }

  private async send<T>(url: URL, method: "GET" | "POST", body: unknown): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(url, {
        method,
        signal: controller.signal,
        headers: {
          "API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = (await response.json().catch(() => ({}))) as ApiResponse<T>;
      if (!response.ok) {
        const retryAfterHeader = response.headers?.get?.("retry-after");
        const retryAfterSeconds = retryAfterHeader ? parseFloat(retryAfterHeader) : undefined;
        throw classifyHttpError(
          response.status,
          (data as { message?: string })?.message || "Paycrest API request failed",
          (data as { data?: unknown })?.data,
          Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        );
      }

      return data;
    } catch (err) {
      if (err instanceof PaycrestApiError) throw err;
      // AbortError or fetch-level transport error.
      throw new NetworkError("Network error calling Paycrest API", err);
    } finally {
      clearTimeout(timeout);
    }
  }

  private isRetryable(err: PaycrestApiError, method: "GET" | "POST"): boolean {
    // Transport errors are always retryable — the server never saw us.
    if (err instanceof NetworkError) return true;
    // For acknowledged server responses, retry only on idempotent methods
    // and only on the retryable status codes.
    if (method !== "GET") return false;
    return RETRYABLE_STATUS_CODES.has(err.statusCode);
  }

  private computeBackoff(attempt: number, err: PaycrestApiError, policy: RetryPolicy): number {
    // Honor Retry-After on 429 when the server tells us exactly how long to wait.
    if (err instanceof RateLimitError && err.retryAfterSeconds && err.retryAfterSeconds > 0) {
      return Math.min(err.retryAfterSeconds * 1000, policy.maxDelayMs);
    }
    const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
    const jittered = Math.random() * exponential;
    return Math.min(jittered, policy.maxDelayMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
