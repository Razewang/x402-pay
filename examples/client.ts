import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CdpX402Client } from "@coinbase/cdp-sdk/x402";
import type { x402Client } from "@x402/core/client";
import { wrapMCPClientWithPayment } from "@x402/mcp";

const network = (process.env.X402_NETWORK ?? "eip155:8453") as
  | "eip155:8453"
  | "eip155:84532";

const paymentClient = new CdpX402Client({
  environment: network === "eip155:84532" ? "development" : "production",
  spendControls: {
    maxAmountPerPayment: { atomic: 20_000n },
    allowedNetworks: [network],
  },
});

const mcpClient = new Client({ name: "base-x402-demo-client", version: "0.1.0" });
// @coinbase/cdp-sdk publishes its declaration as CJS while @x402/mcp uses ESM
// declarations. At runtime both refer to the same x402Client implementation.
const client = wrapMCPClientWithPayment(mcpClient, paymentClient as unknown as x402Client, {
  autoPayment: true,
  onPaymentRequested: async ({ toolName, paymentRequired }) => {
    const quote = paymentRequired.accepts[0];
    console.error(`Approving ${toolName}: ${quote.amount} ${quote.asset} on ${quote.network}`);
    return true;
  },
});

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "examples/server.ts"],
  env: {
    ...process.env,
    PAY_TO: process.env.PAY_TO ?? process.env.BASE_PAY_TO ?? "",
    X402_NETWORK: network,
  },
});

await client.connect(transport);
const result = await client.callTool("paid_add", { a: 2, b: 3 });
console.log(result.content);
if (result.paymentResponse) {
  console.error(`Settled transaction: ${result.paymentResponse.transaction}`);
}
await client.close();
