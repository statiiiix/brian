import type { Context } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./server.js";
import type { App } from "../api/app.js";

// Stateless mode: a fresh server + transport per request. Simple, no session
// bookkeeping, and safe for concurrent clients; fine at this scale. The
// fetch-native transport returns a Response, so the same code runs on Node
// and on the Supabase Edge runtime.
async function handlePost(c: Context): Promise<Response> {
  const server = buildMcpServer();
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 202);
}

export function registerMcpHttp(app: App): void {
  app.post("/mcp", handlePost);
  const notAllowed = (c: Context) =>
    c.json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST (stateless mode)." },
      id: null,
    }, 405);
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
