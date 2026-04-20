import { ApiResponse } from "./types.js";

export class PaycrestApiError extends Error {
  public readonly statusCode: number;
  public readonly details: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "PaycrestApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl: string, apiKey: string, timeoutMs: number, fetcher: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
  }

  public async request<T>({ method, path, query, body }: RequestOptions): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

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

      const data = (await response.json()) as ApiResponse<T>;
      if (!response.ok) {
        throw new PaycrestApiError(data?.message || "Paycrest API request failed", response.status, data?.data);
      }

      return data;
    } catch (error) {
      if (error instanceof PaycrestApiError) {
        throw error;
      }
      throw new PaycrestApiError("Network error calling Paycrest API", 0, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
