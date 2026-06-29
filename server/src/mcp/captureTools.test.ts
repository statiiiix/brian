import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { capture } from "../ingestion/capture.js";
import { findContextWithDistance } from "../context/repo.js";
import type { AnthropicLike } from "../ingestion/draftFromText.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const client: AnthropicLike = {
  messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify([{ kind: "context", confidence: 0.9, content: "ship weekly", summary: "ship weekly", tags: [] }]) }] }) },
};

d("capture + find_context (MCP building blocks)", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("capture then find_context retrieves it", async () => {
    await capture("we ship weekly", client, pool);
    const hit = await findContextWithDistance("how often do we ship", pool);
    expect(hit!.entry.summary).toBe("ship weekly");
  });
});
