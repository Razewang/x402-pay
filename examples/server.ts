import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createBaseX402Receiver } from "../src/base-x402.js";

const server = new McpServer({
  name: "base-x402-demo",
  version: "0.1.0",
});

server.tool("ping", "A free health check", {}, async () => ({
  content: [{ type: "text", text: "pong" }],
}));

const payTo = process.env.PAY_TO ?? process.env.BASE_PAY_TO;
if (!payTo) {
  throw new Error("PAY_TO is required: set it to your Base EVM receiving address");
}

const receiver = await createBaseX402Receiver({
  payTo,
  // Coinbase's production facilitator supports both Base mainnet and Base Sepolia.
  network: (process.env.X402_NETWORK as "eip155:8453" | "eip155:84532" | undefined) ?? "eip155:8453",
});

const paidAdd = await receiver.createPaidTool(
  {
    toolName: "paid_add",
    price: process.env.PAID_ADD_PRICE ?? "$0.001",
    description: "Add two numbers. Charged in USDC on Base.",
  },
  async ({ a, b }: { a: number; b: number }) => ({
    content: [{ type: "text", text: String(a + b) }],
  }),
);

server.tool(
  "paid_add",
  "Add two numbers. Price: $0.001 USDC on Base.",
  { a: z.number(), b: z.number() },
  paidAdd,
);

await server.connect(new StdioServerTransport());
