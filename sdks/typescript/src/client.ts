import { HttpClient } from "./http.js";
import { ProviderClient } from "./provider.js";
import { SenderClient } from "./sender.js";
import { PaycrestClientOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://api.paycrest.io/v2";

export class PaycrestClient {
  private readonly senderHttp?: HttpClient;
  private readonly providerHttp?: HttpClient;

  constructor(options: PaycrestClientOptions) {
    const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    const timeoutMs = options.timeoutMs || 20_000;
    const fetcher = options.fetcher || fetch;
    const senderApiKey = options.senderApiKey || options.apiKey;
    const providerApiKey = options.providerApiKey || options.apiKey;

    if (senderApiKey) {
      this.senderHttp = new HttpClient(baseUrl, senderApiKey, timeoutMs, fetcher);
    }
    if (providerApiKey) {
      this.providerHttp = new HttpClient(baseUrl, providerApiKey, timeoutMs, fetcher);
    }
  }

  public sender(): SenderClient {
    if (!this.senderHttp) {
      throw new Error("senderApiKey is required to initialize sender client");
    }
    return new SenderClient(this.senderHttp);
  }

  public provider(): ProviderClient {
    if (!this.providerHttp) {
      throw new Error("providerApiKey is required to initialize provider client");
    }
    return new ProviderClient(this.providerHttp);
  }
}

export function createPaycrestClient(options: PaycrestClientOptions): PaycrestClient {
  return new PaycrestClient(options);
}
