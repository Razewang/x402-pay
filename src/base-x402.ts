import {
  createPaymentWrapper,
  type MCPToolCallback,
  type PaymentWrappedHandler,
  type PaymentWrapperConfig,
  x402ResourceServer,
} from "@x402/mcp";
import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorClient,
} from "@coinbase/cdp-sdk/x402";
import type { Network, PaymentRequirements, Price } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

export const BASE_MAINNET = "eip155:8453" as const;
export const BASE_SEPOLIA = "eip155:84532" as const;
export type BaseNetwork = typeof BASE_MAINNET | typeof BASE_SEPOLIA;

export interface BaseX402ReceiverOptions {
  /** EVM address that receives USDC. This server never needs its private key. */
  payTo: string;
  /** Defaults to Base mainnet. Use BASE_SEPOLIA for a testnet run. */
  network?: BaseNetwork;
  /** CDP Secret API Key ID. Falls back to CDP_API_KEY_ID. */
  cdpApiKeyId?: string;
  /** CDP Secret API Key Secret. Falls back to CDP_API_KEY_SECRET. */
  cdpApiKeySecret?: string;
  /**
   * Optional override for a CDP staging or custom endpoint.
   * The default is Coinbase's production facilitator.
   */
  facilitatorBaseUrl?: string;
}

export interface PaidBaseToolOptions {
  /** Fixed price, for example "$0.01" or "10000" atomic units. */
  price: Price;
  /** Used for the default mcp://tool/{toolName} resource identifier. */
  toolName: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  resource?: PaymentWrapperConfig["resource"];
  hooks?: PaymentWrapperConfig["hooks"];
  extensions?: PaymentWrapperConfig["extensions"];
}

export interface BaseX402Receiver {
  readonly network: BaseNetwork;
  readonly payTo: string;
  readonly resourceServer: x402ResourceServer;

  /**
   * Builds a reusable MCP callback that verifies and settles x402 payments.
   * Register the returned callback as the final argument of mcpServer.tool().
   */
  createPaidTool<TArgs extends Record<string, unknown>>(
    options: PaidBaseToolOptions,
    handler: PaymentWrappedHandler<TArgs>,
  ): Promise<MCPToolCallback<TArgs>>;

  /**
   * Exposes the generated payment requirements for integrations that need to
   * compose their own wrapper or publish pricing metadata.
   */
  createPaymentRequirements(
    options: Omit<PaidBaseToolOptions, "toolName" | "resource" | "hooks" | "extensions"> & {
      toolName?: string;
    },
  ): Promise<PaymentRequirements[]>;
}

function assertEvmAddress(address: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid EVM payTo address: ${address}`);
  }
}

export async function createBaseX402Receiver(
  options: BaseX402ReceiverOptions,
): Promise<BaseX402Receiver> {
  assertEvmAddress(options.payTo);

  const network = options.network ?? BASE_MAINNET;
  const facilitatorClient = createCdpFacilitatorClient({
    apiKeyId: options.cdpApiKeyId,
    apiKeySecret: options.cdpApiKeySecret,
    baseUrl: options.facilitatorBaseUrl ?? CDP_FACILITATOR_URL,
  });

  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(network, new ExactEvmScheme());
  await resourceServer.initialize();

  async function createPaymentRequirements(
    toolOptions: Omit<PaidBaseToolOptions, "toolName" | "resource" | "hooks" | "extensions"> & {
      toolName?: string;
    },
  ): Promise<PaymentRequirements[]> {
    return resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network: network satisfies Network,
      payTo: options.payTo,
      price: toolOptions.price,
      maxTimeoutSeconds: toolOptions.maxTimeoutSeconds,
      extra: toolOptions.extra,
    });
  }

  return {
    network,
    payTo: options.payTo,
    resourceServer,

    async createPaymentRequirements(toolOptions) {
      return createPaymentRequirements(toolOptions);
    },

    async createPaidTool(toolOptions, handler) {
      const accepts = await createPaymentRequirements(toolOptions);
      const resource = {
        url: `mcp://tool/${encodeURIComponent(toolOptions.toolName)}`,
        description: toolOptions.description,
        mimeType: toolOptions.mimeType ?? "application/json",
        ...toolOptions.resource,
      };

      return createPaymentWrapper(resourceServer, {
        accepts,
        resource,
        hooks: toolOptions.hooks,
        extensions: toolOptions.extensions,
      })(handler);
    },
  };
}
