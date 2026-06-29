import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { ingestBulk } from "./bulk.js";
import type { AnthropicLike } from "./draftFromText.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Returns valid JSON for a doc containing "good", invalid otherwise.
const client: AnthropicLike = {
  messages: {
    create: async (args: any) => {
      const userText = args.messages[0].content as string;
      const text = userText.includes("good")
        ? JSON.stringify([{ kind: "context", confidence: 0.9, content: "a goal", summary: "a goal", tags: [] }])
        : "not json";
      return { content: [{ type: "text", text }] };
    },
  },
};

d("ingestBulk", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("processes good docs and isolates a bad one", async () => {
    const results = await ingestBulk(
      [{ source: "a.txt", text: "good doc" }, { source: "b.txt", text: "bad doc" }],
      client, pool);
    expect(results[0].ok).toBe(true);
    expect(results[0].result!.items.length).toBe(1);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toBeTruthy();
  });
});
