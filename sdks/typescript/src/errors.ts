/**
 * Typed error taxonomy.
 *
 * `PaycrestApiError` is the base class. Specific subclasses let callers
 * branch with `instanceof` instead of string-matching messages. All
 * subclasses preserve the base shape (statusCode + details + message)
 * so existing catch blocks keep working.
 */

export class PaycrestApiError extends Error {
  public readonly statusCode: number;
  public readonly details: unknown;
  /** HTTP response `Retry-After` header (seconds), if the server sent one. */
  public readonly retryAfterSeconds?: number;

  constructor(message: string, statusCode: number, details?: unknown, retryAfterSeconds?: number) {
    super(message);
    this.name = "PaycrestApiError";
    this.statusCode = statusCode;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** One field-level error as returned by the aggregator's 400 responses. */
export interface FieldError {
  field: string;
  message: string;
}

export class ValidationError extends PaycrestApiError {
  /**
   * Structured field-level errors parsed from `details`. The aggregator
   * returns them as `data: [{ field, message }, ...]` on 400 responses;
   * when `details` has that shape they're lifted here for direct binding
   * to form validators. Empty array when none were returned.
   */
  public readonly fieldErrors: ReadonlyArray<FieldError>;

  constructor(message: string, details?: unknown) {
    super(message, 400, details);
    this.name = "ValidationError";
    this.fieldErrors = parseFieldErrors(details);
  }
}

function parseFieldErrors(details: unknown): ReadonlyArray<FieldError> {
  if (!Array.isArray(details)) return [];
  const out: FieldError[] = [];
  for (const item of details) {
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      if (typeof row.field === "string" && typeof row.message === "string") {
        out.push({ field: row.field, message: row.message });
      }
    }
  }
  return out;
}

export class AuthenticationError extends PaycrestApiError {
  constructor(message = "Authentication failed — check API-Key", details?: unknown) {
    super(message, 401, details);
    this.name = "AuthenticationError";
  }
}

export class NotFoundError extends PaycrestApiError {
  constructor(message = "Resource not found", details?: unknown) {
    super(message, 404, details);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends PaycrestApiError {
  constructor(message = "Rate limit exceeded", retryAfterSeconds?: number, details?: unknown) {
    super(message, 429, details, retryAfterSeconds);
    this.name = "RateLimitError";
  }
}

export class ProviderUnavailableError extends PaycrestApiError {
  constructor(message = "No provider available for this order", statusCode = 503, details?: unknown) {
    super(message, statusCode, details);
    this.name = "ProviderUnavailableError";
  }
}

export class OrderRejectedError extends PaycrestApiError {
  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message, statusCode, details);
    this.name = "OrderRejectedError";
  }
}

export class RateQuoteUnavailableError extends PaycrestApiError {
  constructor(message = "Rate quote unavailable for this pair", details?: unknown) {
    super(message, 404, details);
    this.name = "RateQuoteUnavailableError";
  }
}

export class NetworkError extends PaycrestApiError {
  constructor(message: string, cause?: unknown) {
    super(message, 0, cause);
    this.name = "NetworkError";
  }
}

/**
 * Classify an HTTP response into a typed error. Mostly relies on status
 * code; falls back to generic `PaycrestApiError` when there's no
 * specific subclass.
 */
export function classifyHttpError(
  statusCode: number,
  message: string,
  details: unknown,
  retryAfterSeconds?: number,
): PaycrestApiError {
  if (statusCode === 400) return new ValidationError(message, details);
  if (statusCode === 401) return new AuthenticationError(message, details);
  if (statusCode === 403) return new AuthenticationError(message, details);
  if (statusCode === 404) return new NotFoundError(message, details);
  if (statusCode === 429) return new RateLimitError(message, retryAfterSeconds, details);
  if (statusCode === 503) return new ProviderUnavailableError(message, statusCode, details);
  return new PaycrestApiError(message, statusCode, details, retryAfterSeconds);
}
