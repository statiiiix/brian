import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { upsertUser } from "../auth/users.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d("auth routes + dual-mode guard", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await upsertUser({ email: "founder@test.io", password: "hunter22", name: "Founder" });
  });
  afterAll(async () => { await pool.end(); });

  const app = () => testClient(buildApp({ authToken: "static-tok", jwtSecret: "jwt-secret" }));

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const a = app();
    const ok = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    expect(ok.json().user.email).toBe("founder@test.io");

    const bad = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    await a.close();
  });

  it("JWT works on /api routes; /me returns the user; static token still works", async () => {
    const a = app();
    const login = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" } });
    const jwt = login.json().token;

    const viaJwt = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: `Bearer ${jwt}` } });
    expect(viaJwt.statusCode).toBe(200);

    const me = await a.inject({ method: "GET", url: "/api/auth/me",
      headers: { authorization: `Bearer ${jwt}` } });
    expect(me.json().email).toBe("founder@test.io");

    const viaStatic = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer static-tok" } });
    expect(viaStatic.statusCode).toBe(200);

    const meStatic = await a.inject({ method: "GET", url: "/api/auth/me",
      headers: { authorization: "Bearer static-tok" } });
    expect(meStatic.statusCode).toBe(401);

    const nope = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer garbage" } });
    expect(nope.statusCode).toBe(401);
    await a.close();
  });
});
