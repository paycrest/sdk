/**
 * Web-framework webhook middleware.
 *
 * Every integrator ends up writing the same 10 lines: read raw body,
 * compute HMAC, compare, parse JSON, attach to req. Ship it once.
 *
 * Usage (Express):
 *
 *   app.post(
 *     "/webhooks/paycrest",
 *     paycrestWebhook({ secret: process.env.PAYCREST_WEBHOOK_SECRET! }),
 *     (req, res) => {
 *       const event = req.paycrestEvent!;
 *       console.log(event.data.status);
 *       res.status(200).end();
 *     },
 *   );
 *
 * The middleware installs its own `express.text()` body parser so you
 * don't have to — HMAC verification needs the raw bytes, not JSON-
 * re-serialized. If you already have a body parser on the route, pass
 * `parseRawBody: false` and expose the raw body on `req.rawBody`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { verifyWebhookSignature } from "./webhooks.js";
import type { PaymentOrder } from "./types.js";

export interface PaycrestWebhookEvent<T = PaymentOrder> {
  event?: string;
  timestamp?: string;
  data: T;
}

export interface PaycrestWebhookOptions {
  /** Shared secret used by the aggregator to sign the webhook body. */
  secret: string;
  /** Header name that carries the signature. Defaults to `x-paycrest-signature`. */
  signatureHeader?: string;
  /**
   * Parse the raw body if no body parser has already populated `req.rawBody`.
   * Defaults to true.
   */
  parseRawBody?: boolean;
}

type NextFn = (err?: unknown) => void;

interface RequestWithRaw extends IncomingMessage {
  rawBody?: string | Buffer;
  body?: unknown;
  paycrestEvent?: PaycrestWebhookEvent;
  header?: (name: string) => string | undefined;
}

/**
 * Express-compatible webhook middleware. Any framework whose middleware
 * shape is `(req, res, next)` (Express, Connect, Next.js custom server,
 * Fastify via `.use(...)`, etc.) can use this directly.
 */
export function paycrestWebhook(options: PaycrestWebhookOptions) {
  if (!options?.secret) {
    throw new Error("paycrestWebhook: options.secret is required");
  }
  const headerName = (options.signatureHeader ?? "x-paycrest-signature").toLowerCase();
  const parseRawBody = options.parseRawBody !== false;

  return async function handle(req: RequestWithRaw, res: ServerResponse, next: NextFn): Promise<void> {
    try {
      const rawBody = await resolveRawBody(req, parseRawBody);
      const signature = getHeader(req, headerName);

      if (!signature) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "missing signature" }));
        return;
      }
      if (!verifyWebhookSignature(rawBody, signature, options.secret)) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid signature" }));
        return;
      }

      try {
        req.paycrestEvent = JSON.parse(rawBody) as PaycrestWebhookEvent;
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

function getHeader(req: RequestWithRaw, name: string): string | undefined {
  if (typeof req.header === "function") {
    return req.header(name) ?? req.header(name.toLowerCase()) ?? undefined;
  }
  const value = (req.headers ?? {})[name] ?? (req.headers ?? {})[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

async function resolveRawBody(req: RequestWithRaw, parseRawBody: boolean): Promise<string> {
  if (req.rawBody !== undefined) {
    return typeof req.rawBody === "string" ? req.rawBody : req.rawBody.toString("utf8");
  }
  // Some frameworks (Express with express.text()) populate `req.body`
  // as a string before this middleware runs.
  if (typeof req.body === "string") {
    return req.body;
  }
  if (!parseRawBody) {
    throw new Error(
      "paycrestWebhook: req.rawBody is empty and parseRawBody=false. Mount `express.text({ type: '*/*' })` before this middleware, or leave parseRawBody enabled.",
    );
  }
  return await readBody(req);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Framework-agnostic helper for any app that already has the raw bytes
 * + header in hand (e.g. Next.js route handler, custom HTTP server,
 * edge runtimes). Returns the parsed + verified event or throws.
 */
export function parsePaycrestWebhook<T = PaymentOrder>(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): PaycrestWebhookEvent<T> {
  if (!signature) {
    throw new Error("paycrest webhook: missing signature");
  }
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new Error("paycrest webhook: invalid signature");
  }
  return JSON.parse(rawBody) as PaycrestWebhookEvent<T>;
}
