import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill } from "../skills/repo.js";
import { listExecutions } from "../feedback/executions.js";
import { buildMcpServer } from "./server.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("log_execution MCP tool", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("writes an execution row through the MCP surface", async () => {
    const s = await createSkill(
      { name: "X", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const res = await client.callTool({
      name: "log_execution",
      arguments: {
        skill_id: s.id,
        skill_version: 1,
        task_input: "customer asked for CSV export info",
        actions_taken: "find_skill; create_email_draft(draft_id=d1)",
        outcome: "completed",
      },
    });
    expect(JSON.parse((res.content as any)[0].text).outcome).toBe("completed");

    // The tool writes via the default pool; under vitest the default pool
    // also uses TEST_DATABASE_URL (see db/pool.ts), so this is the same DB.
    const log = await listExecutions(s.id, pool);
    expect(log.length).toBe(1);
    expect(log[0].task_input).toBe("customer asked for CSV export info");

    await client.close();
    await server.close();
  });
});
