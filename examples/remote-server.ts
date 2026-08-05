import "dotenv/config";

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createDemoMcpServer } from "./demo-server.js";

const transports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);

    if (!transport && isInitializeRequest(parsed)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = await createDemoMcpServer();
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      if (transport.sessionId) transports.set(transport.sessionId, transport);
      return;
    }

    if (transport) {
      await transport.handleRequest(req, res, parsed);
      return;
    }
  }

  if (transport && req.method === "GET") {
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(400);
  res.end("Invalid MCP request");
});

const port = Number(process.env.PORT ?? 8787);
httpServer.listen(port, () => {
  console.log(`x402 MCP remote server listening on http://localhost:${port}/mcp`);
});
