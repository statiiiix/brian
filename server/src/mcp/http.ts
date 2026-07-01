import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./server.js";

// Stateless mode: a fresh server + transport per request. Simple, no session
// bookkeeping, and safe for concurrent clients; fine at this scale.
async function handlePost(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack(); // the transport writes directly to the raw response
  // Clean up when the RESPONSE closes (request 'close' fires as soon as the
  // body is consumed, which would tear the transport down before it replies).
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
}

export function registerMcpHttp(app: FastifyInstance): void {
  app.post("/mcp", handlePost);
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST (stateless mode)." },
      id: null,
    });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
