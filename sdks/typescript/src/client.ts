import { HttpClient } from "./http.js";
import { SenderClient } from "./sender.js";
import { PaycrestClientOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://api.paycrest.io/v2";

export class PaycrestClient {
  private readonly http: HttpClient;

  constructor(options: PaycrestClientOptions) {
    if (!options.apiKey) {
      throw new Error("apiKey is required");
    }
    this.http = new HttpClient(
      options.baseUrl || DEFAULT_BASE_URL,
      options.apiKey,
      options.timeoutMs || 20_000,
      options.fetcher || fetch,
    );
  }

  public sender(): SenderClient {
    return new SenderClient(this.http);
  }

  public provider(): never {
    throw new Error("Provider SDK support is not available yet in v2 monorepo.");
  }
}

export function createPaycrestClient(options: PaycrestClientOptions): PaycrestClient {
  return new PaycrestClient(options);
}
