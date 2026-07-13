import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("bearer auth", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("rejects agent bearers on dashboard routes and accepts them only at MCP", async () => {
    const app = testClient(buildApp({ authToken: "sekret" }));

    const noAuth = await app.inject({ method: "GET", url: "/api/skills" });
    expect(noAuth.statusCode).toBe(401);
    expect(noAuth.json()).toEqual({ error: "unauthorized" });

    const badAuth = await app.inject({
      method: "GET", url: "/api/skills", headers: { authorization: "Bearer wrong" },
    });
    expect(badAuth.statusCode).toBe(401);

    const goodAuth = await app.inject({
      method: "GET", url: "/api/skills", headers: { authorization: "Bearer sekret" },
    });
    expect(goodAuth.statusCode).toBe(401);

    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: "Bearer sekret",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      },
    });
    expect(mcp.statusCode).toBe(200);
    await app.close();
  });

  it("stays open when no token is configured", async () => {
    const app = testClient(buildApp());
    const res = await app.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
