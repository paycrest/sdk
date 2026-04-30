import { HttpClient } from "./http.js";

export interface SupportedToken {
  symbol: string;
  contractAddress: `0x${string}`;
  decimals: number;
  baseCurrency: string;
  network: string;
}

/**
 * Process-level static token registry. Operators can call
 * `registerToken(...)` once at startup with the addresses they care
 * about — the gateway path resolves them without a `/v2/tokens` round-trip.
 *
 * Lookup order in `AggregatorRegistry.getToken`: static registry →
 * cached `/tokens` fetch → live `/tokens` fetch. First hit wins.
 */
const STATIC_TOKENS = new Map<string, SupportedToken>();

function staticKey(network: string, symbol: string): string {
  return `${network.toLowerCase()}::${symbol.toUpperCase()}`;
}

/**
 * Register a token statically so the gateway path resolves it without
 * hitting `/v2/tokens`. Useful for hot tokens (USDT/USDC) the app uses
 * on every order.
 */
export function registerToken(token: SupportedToken): void {
  STATIC_TOKENS.set(staticKey(token.network, token.symbol), token);
}

/** Bulk-register a list of tokens (e.g. from a curated `tokens.json`). */
export function registerTokens(tokens: ReadonlyArray<SupportedToken>): void {
  for (const t of tokens) registerToken(t);
}

/** Read-only view of the static registry. Handy for tests + audits. */
export function listRegisteredTokens(): SupportedToken[] {
  return Array.from(STATIC_TOKENS.values());
}

/** Reset the static registry. Test-only escape hatch. */
export function clearRegisteredTokens(): void {
  STATIC_TOKENS.clear();
}

/**
 * Per-process cache for the aggregator's RSA public key (PEM) and the
 * token catalogue. Both are fetched lazily on first use and reused for
 * the lifetime of the process.
 *
 * Pass an `override` PEM to `getPublicKey()` to bypass the network
 * fetch (handy in tests or air-gapped environments).
 */
export class AggregatorRegistry {
  private publicKey?: string;
  private tokensByNetwork = new Map<string, SupportedToken[]>();

  constructor(
    private readonly http: HttpClient,
    private readonly publicKeyOverride?: string,
  ) {}

  public async getPublicKey(): Promise<string> {
    if (this.publicKeyOverride) {
      return this.publicKeyOverride;
    }
    if (this.publicKey) {
      return this.publicKey;
    }
    const response = await this.http.request<string>({
      method: "GET",
      path: "/pubkey",
    });
    if (!response.data || typeof response.data !== "string") {
      throw new Error("Aggregator /pubkey returned no PEM data");
    }
    this.publicKey = response.data;
    return this.publicKey;
  }

  public async getToken(network: string, symbol: string): Promise<SupportedToken> {
    // 1) Static registry (zero-RTT for hot tokens).
    const staticHit = STATIC_TOKENS.get(staticKey(network, symbol));
    if (staticHit) return staticHit;

    // 2) Live fetch (with in-process cache via getTokensForNetwork).
    const tokens = await this.getTokensForNetwork(network);
    const target = symbol.toUpperCase();
    const match = tokens.find((t) => t.symbol.toUpperCase() === target);
    if (!match) {
      throw new Error(
        `Token "${symbol}" is not enabled on network "${network}". ` +
          `Known: ${tokens.map((t) => t.symbol).join(", ") || "(none)"}`,
      );
    }
    return match;
  }

  public async getTokensForNetwork(network: string): Promise<SupportedToken[]> {
    const slug = network.toLowerCase();
    const cached = this.tokensByNetwork.get(slug);
    if (cached) {
      return cached;
    }
    const response = await this.http.request<SupportedToken[]>({
      method: "GET",
      path: "/tokens",
      query: { network: slug },
    });
    const tokens = response.data ?? [];
    this.tokensByNetwork.set(slug, tokens);
    return tokens;
  }

  /**
   * Pre-warm the in-memory cache for a network. Useful at app startup
   * to take the `/v2/tokens` round-trip out of the order hot path.
   */
  public async preload(network: string): Promise<SupportedToken[]> {
    return this.getTokensForNetwork(network);
  }
}
