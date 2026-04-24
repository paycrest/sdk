import { HttpClient } from "./http.js";

export interface SupportedToken {
  symbol: string;
  contractAddress: `0x${string}`;
  decimals: number;
  baseCurrency: string;
  network: string;
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
}
