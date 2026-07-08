import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const valid = { name: "Refunds", trigger: "refund request", procedure: "do the steps" };

d("API", () => {
  const app = testClient(buildApp());
  beforeAll(async () => { await runMigrations(pool); await app.ready(); });
  afterAll(async () => { await app.close(); await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("creates a draft skill via POST", async () => {
    const res = await app.inject({ method: "POST", url: "/api/skills", payload: valid });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("draft");
  });

  it("rejects invalid input with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/skills", payload: { name: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("404s an unknown skill", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skills/00000000-0000-0000-0000-000000000000" });
    expect(res.statusCode).toBe(404);
  });

  it("activates a skill", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/skills", payload: valid })).json();
    const res = await app.inject({ method: "POST", url: `/api/skills/${created.id}/activate` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
  });

  it("returns version history after an edit", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/skills", payload: valid })).json();
    await app.inject({ method: "PUT", url: `/api/skills/${created.id}`, payload: { procedure: "v2 steps" } });
    const res = await app.inject({ method: "GET", url: `/api/skills/${created.id}/versions` });
    expect(res.json().length).toBe(1);
  });
});
