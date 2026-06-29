import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)) }));

import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("context API", () => {
  const app = buildApp();
  beforeAll(async () => { await runMigrations(pool); await app.ready(); });
  afterAll(async () => { await app.close(); await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("creates and fetches a context entry", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/context", payload: { content: "We bill annually" } })).json();
    expect(created.status).toBe("active");
    const got = await app.inject({ method: "GET", url: `/api/context/${created.id}` });
    expect(got.statusCode).toBe(200);
  });

  it("rejects empty content with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/context", payload: { content: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("capture endpoint requires text", async () => {
    const res = await app.inject({ method: "POST", url: "/api/capture", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("bulk endpoint requires a docs array", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ingest/bulk", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
