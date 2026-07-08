import { describe, it, expect, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { buildApp } from "../api/app.js";
import { testClient } from "../test/http.js";

const initReq = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  },
};

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("MCP over streamable HTTP", () => {
  it("answers initialize on POST /mcp", async () => {
    const app = testClient(buildApp());
    const res = await app.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initReq });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"serverInfo"');
    expect(res.body).toContain('"brian"');
    await app.close();
  });

  it("rejects GET with 405", async () => {
    const app = testClient(buildApp());
    const res = await app.inject({
      method: "GET", url: "/mcp",
      headers: { accept: "application/json, text/event-stream" },
    });
    expect(res.statusCode).toBe(405);
    await app.close();
  });

  it("requires the bearer token when auth is on", async () => {
    const app = testClient(buildApp({ authToken: "sekret" }));
    const res = await app.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initReq });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
