import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/launch|q3|goal/i.test(text)) v[0] = 1;
  if (/refund|support/i.test(text)) v[1] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async (t: string) => fakeVec(t)) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createContext, getContext, listContext, updateContext, retireContext, listContextVersions, findContextWithDistance } from "./repo.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("context repo", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  const sample = { content: "We want to launch in Q3", summary: "Q3 launch goal", tags: ["goal"], source: "capture", owner: "me" };

  it("creates an active context entry", async () => {
    const c = await createContext(sample, pool);
    expect(c.status).toBe("active");
    expect(c.version).toBe(1);
    expect(await getContext(c.id, pool)).not.toBeNull();
  });

  it("update snapshots version and bumps", async () => {
    const c = await createContext(sample, pool);
    const u = await updateContext(c.id, { content: "Launch moved to Q4" }, "me", pool);
    expect(u.version).toBe(2);
    expect((await listContextVersions(c.id, pool)).length).toBe(1);
  });

  it("retire hides from active list", async () => {
    const c = await createContext(sample, pool);
    await retireContext(c.id, pool);
    expect((await listContext("active", pool)).length).toBe(0);
  });

  it("findContextWithDistance returns nearest active with a distance", async () => {
    await createContext(sample, pool);
    const hit = await findContextWithDistance("what is our launch goal", pool);
    expect(hit).not.toBeNull();
    expect(hit!.entry.summary).toBe("Q3 launch goal");
    expect(typeof hit!.distance).toBe("number");
  });
});
