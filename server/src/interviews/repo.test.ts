import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import {
  createInterview, getInterview, listInterviews, appendMessage,
  setTurnResult, completeInterview, abandonInterview, resumeInterview,
} from "./repo.js";
import { EMPTY_COVERAGE } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const draft = {
  name: "Refund Handling", trigger: "Customer asks for refund", inputs: ["order_id"],
  procedure: "1. look up. 2. refund.", hard_rules: ["never > $200"], tools: ["get_order"],
  guardrails: ["stop if > $200"], escalation_target: "lead", examples: [], owner: "Sam",
};

d("interviews repo", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await pool.query("delete from interviews");
  });
  afterAll(async () => { await pool.end(); });

  it("creates with defaults and lists newest first", async () => {
    const a = await createInterview({ topic: "refunds", owner: "Sam" });
    expect(a.status).toBe("active");
    expect(a.messages).toEqual([]);
    expect(a.coverage).toEqual(EMPTY_COVERAGE);
    const b = await createInterview({ topic: "pricing" });
    const list = await listInterviews();
    expect(list[0].id).toBe(b.id);
  });

  it("appends messages with timestamps", async () => {
    const iv = await createInterview({ topic: "sev2" });
    await appendMessage(iv.id, { role: "brian", content: "What triggers this?" });
    const got = await appendMessage(iv.id, { role: "expert", content: "An alert fires." });
    expect(got.messages).toHaveLength(2);
    expect(got.messages[1].role).toBe("expert");
    expect(got.messages[1].at).toBeTruthy();
  });

  it("setTurnResult stores coverage, and draft flips status to ready", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const asking = await setTurnResult(iv.id, {
      coverage: { ...EMPTY_COVERAGE, trigger: true },
    });
    expect(asking.status).toBe("active");
    expect(asking.coverage.trigger).toBe(true);

    const ready = await setTurnResult(iv.id, {
      coverage: { trigger: true, inputs: true, procedure: true, hard_rules: true,
        guardrails: true, escalation_target: true, examples: true },
      draft,
    });
    expect(ready.status).toBe("ready");
    expect(ready.draft?.name).toBe("Refund Handling");
  });

  it("completes and abandons", async () => {
    const iv = await createInterview({ topic: "x" });
    const ab = await abandonInterview(iv.id);
    expect(ab.status).toBe("abandoned");

    const iv2 = await createInterview({ topic: "y" });
    const { rows } = await pool.query(
      `insert into skills (name, trigger, procedure) values ('s','t','p') returning id`);
    const done = await completeInterview(iv2.id, rows[0].id);
    expect(done.status).toBe("completed");
    expect(done.resulting_skill_id).toBe(rows[0].id);
  });

  it("resumes an abandoned interview back to active", async () => {
    const iv = await createInterview({ topic: "resume-me" });
    const ab = await abandonInterview(iv.id);
    expect(ab.status).toBe("abandoned");
    const resumed = await resumeInterview(iv.id);
    expect(resumed.status).toBe("active");
  });

  it("getInterview returns null for unknown id", async () => {
    expect(await getInterview("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
