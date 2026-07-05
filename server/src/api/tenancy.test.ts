import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "./app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { createSkill } from "../skills/repo.js";
import { ensureToken } from "../auth/apiTokens.js";
import type { NewSkill } from "../skills/types.js";

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
  const app = buildApp({ authToken: FOUNDING_TOKEN });
  let foundingSkillId = "";
  let acmeSkillId = "";

  beforeAll(async () => {
    await runMigrations(pool);
    await cleanup();
    await pool.query(
      "insert into tenants (id, name, slug) values ($1,'Acme','__tenancy-acme') on conflict (id) do nothing",
      [ACME],
    );
    await ensureToken(ACME, ACME_TOKEN, "__tenancy acme");
    foundingSkillId = (await runTenant(FOUNDING_TENANT_ID, () => createSkill(newSkill("__tenancy-founding")))).id;
    acmeSkillId = (await runTenant(ACME, () => createSkill(newSkill("__tenancy-acme")))).id;
    await app.ready();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await pool.end();
  });

  it("a founding-token request sees founding skills, never acme's", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/skills",
      headers: { authorization: `Bearer ${FOUNDING_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(foundingSkillId);
    expect(ids).not.toContain(acmeSkillId);
  });

  it("an acme-token request sees acme skills, never founding's", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/skills",
      headers: { authorization: `Bearer ${ACME_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(acmeSkillId);
    expect(ids).not.toContain(foundingSkillId);
  });

  it("rejects an unknown bearer", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});
