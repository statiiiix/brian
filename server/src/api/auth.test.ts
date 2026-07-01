import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("bearer auth", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("rejects requests without or with a wrong token, accepts the right one", async () => {
    const app = buildApp({ authToken: "sekret" });

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
    expect(goodAuth.statusCode).toBe(200);
    await app.close();
  });

  it("stays open when no token is configured", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
