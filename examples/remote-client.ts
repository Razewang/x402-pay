import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CdpX402Client } from "@coinbase/cdp-sdk/x402";
import type { x402Client } from "@x402/core/client";
import { wrapMCPClientWithPayment } from "@x402/mcp";

const url = new URL(process.env.MCP_URL ?? "http://localhost:8787/mcp");
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

const rawClient = new Client({ name: "x402-remote-client", version: "0.1.0" });
const client = wrapMCPClientWithPayment(
  rawClient,
  paymentClient as unknown as x402Client,
  {
    autoPayment: true,
    onPaymentRequested: async ({ toolName, paymentRequired }) => {
      const quote = paymentRequired.accepts[0];
      console.error(
        `Paying ${toolName}: ${quote.amount} ${quote.asset} on ${quote.network}`,
      );
      return true;
    },
  },
);

await client.connect(new StreamableHTTPClientTransport(url));
const result = await client.callTool("paid_add", { a: 10, b: 20 });
console.log(JSON.stringify(result.content, null, 2));
await client.close();
