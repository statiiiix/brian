import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { createSkill, setStatus } from "../skills/repo.js";
import { ensureToken } from "../auth/apiTokens.js";
import type { NewSkill } from "../skills/types.js";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: async () => new Array(1536).fill(0.01),
}));

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000ac000";
const FOUNDING_TOKEN = "founding-static-__tenancy";
const ACME_TOKEN = "acme-agent-__tenancy";

function newSkill(name: string): NewSkill {
  return {
    name, trigger: `${name} trigger`, inputs: [], procedure: `${name} procedure`,
    hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null,
  };
}

async function cleanup() {
  await pool.query("delete from skills where name in ('__tenancy-founding','__tenancy-acme')");
  await pool.query("delete from api_tokens where label like '__tenancy%'");
  await pool.query("delete from tenants where id = $1", [ACME]);
}

d("tenant isolation via the HTTP guard", () => {
  const app = testClient(buildApp({ authToken: FOUNDING_TOKEN }));
  let foundingSkillId = "";
  let acmeSkillId = "";

  beforeAll(async () => {
    await runMigrations(pool);
    await cleanup();
    await pool.query(
      "insert into tenants (id, name, slug) values ($1,'Acme','__tenancy-acme') on conflict (id) do nothing",
      [ACME],
    );
    await ensureToken(
      ACME,
      ACME_TOKEN,
      "__tenancy acme",
      new Date(Date.now() + 60 * 60 * 1000),
    );
    foundingSkillId = (await runTenant(FOUNDING_TENANT_ID, async () => {
      const skill = await createSkill(newSkill("__tenancy-founding"));
      return setStatus(skill.id, "active");
    })).id;
    acmeSkillId = (await runTenant(ACME, async () => {
      const skill = await createSkill(newSkill("__tenancy-acme"));
      return setStatus(skill.id, "active");
    })).id;
    await app.ready();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await pool.end();
  });

  it("a founding agent token resolves only founding knowledge", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing", payload: { query: "tenant skill" },
      headers: { authorization: `Bearer ${FOUNDING_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skill?.id).toBe(foundingSkillId);
    expect(res.json().skill?.id).not.toBe(acmeSkillId);
  });

  it("an acme agent token resolves only acme knowledge", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing", payload: { query: "tenant skill" },
      headers: { authorization: `Bearer ${ACME_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skill?.id).toBe(acmeSkillId);
    expect(res.json().skill?.id).not.toBe(foundingSkillId);
  });

  it("rejects an unknown bearer", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing", payload: { query: "tenant skill" },
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});
