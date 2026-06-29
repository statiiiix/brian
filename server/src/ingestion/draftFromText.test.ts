import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { pool } from "../db/pool.js";
import { draftFromText } from "./draftFromText.js";
import type { LlmClient } from "../llm/complete.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const fakeClient: LlmClient = {
  complete: async () =>
    JSON.stringify({
      name: "Password Reset", trigger: "user locked out", inputs: ["email"],
      procedure: "verify identity then reset", hard_rules: ["never reset without identity check"],
      tools: ["lookup_user"], guardrails: ["if account flagged, escalate"],
      escalation_target: "Security", examples: [], owner: "IT",
    }),
};

d("draftFromText", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("drafts a valid skill from text and stores it as draft", async () => {
    const skill = await draftFromText("When a user is locked out...", fakeClient);
    expect(skill.name).toBe("Password Reset");
    expect(skill.status).toBe("draft");
    expect(skill.version).toBe(1);
  });

  it("rejects malformed model output", async () => {
    const bad: LlmClient = { complete: async () => "not json" };
    await expect(draftFromText("x", bad)).rejects.toThrow();
  });
});
