import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { inject } from "./http.js";

describe("inject helper", () => {
  it("posts JSON and reads JSON", async () => {
    const app = new Hono();
    app.post("/echo", async (c) => c.json(await c.req.json(), 201));
    const res = await inject(app, { method: "POST", url: "/echo", payload: { a: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().a).toBe(1);
  });

  it("passes headers and supports GET with query", async () => {
    const app = new Hono();
    app.get("/q", (c) => c.json({ v: c.req.query("v"), auth: c.req.header("authorization") ?? null }));
    const res = await inject(app, {
      method: "GET", url: "/q?v=7", headers: { authorization: "Bearer t" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ v: "7", auth: "Bearer t" });
  });
});
