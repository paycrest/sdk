import { randomUUID } from "node:crypto";

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
  /**
   * Idempotency key to attach as `Idempotency-Key` header. If omitted
   * on a POST, the HTTP client auto-generates a UUIDv4 so retries of
   * the same logical request stay linked even across network
   * uncertainty. The key is stable across retry attempts within a
   * single `request()` call.
   */
  idempotencyKey?: string;
  /**
   * Caller-supplied cancellation signal. When aborted, the in-flight
   * request throws a NetworkError and the retry loop bails out
   * immediately. Composed with the internal per-request timeout.
   */
  signal?: AbortSignal;
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

/**
 * Observation hooks fired by the HTTP client. Hooks never mutate the
 * request or response — they exist purely for integrators who want to
 * plug in logging / metrics / tracing (OpenTelemetry, Datadog, etc.)
 * without forking the SDK. Errors thrown from hooks are swallowed so
 * a faulty tracer can't break the SDK's own error semantics.
 */
export interface RequestHookContext {
  method: "GET" | "POST";
  url: string;
  attempt: number;
  idempotencyKey?: string;
}

export interface ResponseHookContext extends RequestHookContext {
  statusCode: number;
  durationMs: number;
}

export interface ErrorHookContext extends RequestHookContext {
  error: unknown;
  durationMs: number;
  statusCode?: number;
}

export interface RequestHooks {
  onRequest?(ctx: RequestHookContext): void | Promise<void>;
  onResponse?(ctx: ResponseHookContext): void | Promise<void>;
  onError?(ctx: ErrorHookContext): void | Promise<void>;
}

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly retryPolicy: RetryPolicy;
  private readonly hooks: RequestHooks;

  constructor(
    baseUrl: string,
    apiKey: string,
    timeoutMs: number,
    fetcher: typeof fetch,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    hooks: RequestHooks = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
    this.retryPolicy = retryPolicy;
    this.hooks = hooks;
  }

  public async request<T>({ method, path, query, body, retry, idempotencyKey, signal }: RequestOptions): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const policy = { ...this.retryPolicy, ...retry };
    const effectiveIdempotencyKey =
      idempotencyKey ?? (method === "POST" ? randomUUID() : undefined);
    let lastError: PaycrestApiError | undefined;

    for (let attempt = 1; attempt <= policy.retries; attempt++) {
      if (signal?.aborted) {
        throw new NetworkError("Request aborted by caller");
      }
      const baseCtx: RequestHookContext = {
        method,
        url: url.toString(),
        attempt,
        idempotencyKey: effectiveIdempotencyKey,
      };
      await safelyInvoke(this.hooks.onRequest, baseCtx);
      const startedAt = Date.now();
      try {
        const response = await this.send<T>(url, method, body, effectiveIdempotencyKey, signal);
        await safelyInvoke(this.hooks.onResponse, {
          ...baseCtx,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch (err) {
        const typedErr = err instanceof PaycrestApiError ? err : new NetworkError("Unexpected transport error", err);
        await safelyInvoke(this.hooks.onError, {
          ...baseCtx,
          error: typedErr,
          statusCode: typedErr.statusCode || undefined,
          durationMs: Date.now() - startedAt,
        });
        lastError = typedErr;
        if (signal?.aborted) {
          throw new NetworkError("Request aborted by caller");
        }
        if (attempt >= policy.retries) break;

        const retryable = this.isRetryable(typedErr, method);
        if (!retryable) break;

        const delay = this.computeBackoff(attempt, typedErr, policy);
        await sleep(delay);
      }
    }

    throw lastError ?? new NetworkError("Unknown HTTP failure");
  }

  private async send<T>(url: URL, method: "GET" | "POST", body: unknown, idempotencyKey?: string, callerSignal?: AbortSignal): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    // If the caller passed a signal, propagate its abort into our
    // timeout-managed controller so the in-flight fetch unwinds.
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    try {
      const headers: Record<string, string> = {
        "API-Key": this.apiKey,
        "Content-Type": "application/json",
      };
      if (idempotencyKey) {
        headers["Idempotency-Key"] = idempotencyKey;
      }
      const response = await this.fetcher(url, {
        method,
        signal: controller.signal,
        headers,
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
      if (callerSignal) {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
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

async function safelyInvoke<T>(
  hook: ((ctx: T) => void | Promise<void>) | undefined,
  ctx: T,
): Promise<void> {
  if (!hook) return;
  try {
    await hook(ctx);
  } catch {
    // A faulty tracer / logger hook must not break SDK semantics.
    // Consumers who care about hook failures should catch inside the hook.
  }
}
