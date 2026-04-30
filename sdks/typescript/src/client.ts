import { GatewayClient } from "./gateway-client.js";
import { HttpClient } from "./http.js";
import { ProviderClient } from "./provider.js";
import { AggregatorRegistry } from "./registry.js";
import { SenderClient } from "./sender.js";
import { PaycrestClientOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://api.paycrest.io/v2";

export class PaycrestClient {
  private readonly senderHttp?: HttpClient;
  private readonly providerHttp?: HttpClient;
  private readonly publicHttp: HttpClient;
  private readonly registry: AggregatorRegistry;
  private readonly gatewayClient?: GatewayClient;

  constructor(options: PaycrestClientOptions) {
    const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    const timeoutMs = options.timeoutMs || 20_000;
    const fetcher = options.fetcher || fetch;
    const senderApiKey = options.senderApiKey || options.apiKey;
    const providerApiKey = options.providerApiKey || options.apiKey;

    const hooks = options.hooks ?? {};
    this.publicHttp = new HttpClient(baseUrl, "", timeoutMs, fetcher, undefined, hooks);
    this.registry = new AggregatorRegistry(
      this.publicHttp,
      options.gateway?.aggregatorPublicKey,
    );

    if (senderApiKey) {
      this.senderHttp = new HttpClient(baseUrl, senderApiKey, timeoutMs, fetcher, undefined, hooks);
    }
    if (providerApiKey) {
      this.providerHttp = new HttpClient(baseUrl, providerApiKey, timeoutMs, fetcher, undefined, hooks);
    }

    if (options.gateway?.signer && options.gateway?.publicClient) {
      this.gatewayClient = new GatewayClient(this.registry, {
        signer: options.gateway.signer,
        publicClient: options.gateway.publicClient,
        aggregatorHttp: this.publicHttp,
      });
    }
  }

  public sender(): SenderClient {
    if (!this.senderHttp) {
      throw new Error("senderApiKey is required to initialize sender client");
    }
    return new SenderClient(this.senderHttp, this.gatewayClient);
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
