import { Hono } from "hono";
import type { Context, Next } from "hono";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import {
  createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions, NotFoundError,
  findSkillsWithDistance,
} from "../skills/repo.js";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "../skills/validation.js";
import { listExecutions } from "../feedback/executions.js";
import { draftFromText } from "../ingestion/draftFromText.js";
import type { SkillStatus } from "../skills/types.js";
import { createContext, getContext, listContext, updateContext, retireContext, listContextVersions, findContextWithDistance } from "../context/repo.js";
import { parseNewContext, parseUpdateContext } from "../context/validation.js";
import { capture } from "../ingestion/capture.js";
import { ingestBulk } from "../ingestion/bulk.js";
import type { ContextStatus } from "../context/types.js";
import { registerMcpHttp } from "../mcp/http.js";
import { findUserByEmail, verifyPassword } from "../auth/users.js";
import { signUserToken, verifyUserToken, type TokenUser } from "../auth/jwt.js";
import {
  looksLikeSupabaseToken, verifySupabaseToken, supabaseAuthFromEnv,
  type SupabaseAuthConfig,
} from "../auth/supabase.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { tenantForToken } from "../auth/apiTokens.js";
import {
  createInterview, getInterview, listInterviews, appendMessage as appendInterviewMessage,
  completeInterview, abandonInterview, resumeInterview,
} from "../interviews/repo.js";
import { runTurn } from "../interviews/engine.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { listConnectors, upsertConnector, evidenceForDraft } from "../connectors/repo.js";
import { syncConnector, type SyncSummary } from "../connectors/sync.js";
import { CONNECTOR_TYPES } from "../connectors/adapters/index.js";
import type { ConnectorType, ConnectorRow } from "../connectors/types.js";

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface AppOptions {
  authToken?: string | null;
  jwtSecret?: string | null;
  supabaseAuth?: SupabaseAuthConfig | null;
  llm?: LlmClient;
  sync?: (type: ConnectorType) => Promise<SyncSummary>;
}

// Never expose stored connector credentials over the API.
function publicConnector(c: ConnectorRow): Omit<ConnectorRow, "credentials"> & { configured: boolean } {
  const { credentials, ...rest } = c;
  return { ...rest, configured: Object.keys(credentials ?? {}).length > 0 };
}

export type AppEnv = { Variables: { user?: TokenUser } };
export type App = Hono<AppEnv>;

const PUBLIC_PATHS = new Set(["/api/auth/login"]);

// Vector-search hits farther than this cosine distance are treated as
// no-match so hooks don't inject unrelated skills into every prompt.
const BRIEFING_MAX_DISTANCE = 0.6;

// Fastify parsed missing/empty JSON bodies to undefined; keep that tolerance.
async function jsonBody(c: Context): Promise<any> {
  return c.req.json().catch(() => undefined);
}

export function buildApp(opts: AppOptions = {}): App {
  const app = new Hono<AppEnv>();
  const authToken = opts.authToken ?? null;
  const jwtSecret = opts.jwtSecret ?? null;
  const supabaseAuth = opts.supabaseAuth === undefined ? supabaseAuthFromEnv() : opts.supabaseAuth;

  if (authToken || jwtSecret || supabaseAuth) {
    // Bind the resolved tenant for the whole downstream request. Hono
    // middleware is promise-based, so als.run can wrap next() directly.
    app.use("*", async (c: Context<AppEnv>, next: Next) => {
      if (PUBLIC_PATHS.has(c.req.path)) return next();
      const header = c.req.header("authorization");
      // 1) Static founding bearer (BRIAN_API_TOKEN) — the founding tenant.
      if (authToken && bearerMatches(header, authToken)) {
        return runTenant(FOUNDING_TENANT_ID, () => next());
      }
      if (header?.startsWith("Bearer ")) {
        const raw = header.slice("Bearer ".length);
        // 2) Per-tenant agent token (api_tokens), else dashboard humans:
        // 3) legacy custom JWT (local verify, founding tenant; removed once
        //    all users are migrated), 4) Supabase Auth access token —
        //    validated by the auth server, tenant/role from app_metadata.
        const tenantId = await tenantForToken(raw).catch(() => null);
        if (tenantId) return runTenant(tenantId, () => next());
        if (jwtSecret) {
          const u = verifyUserToken(raw, jwtSecret);
          if (u) {
            c.set("user", u);
            return runTenant(FOUNDING_TENANT_ID, () => next());
          }
        }
        if (supabaseAuth && looksLikeSupabaseToken(raw)) {
          const su = await verifySupabaseToken(raw, supabaseAuth);
          if (su) {
            c.set("user", { id: su.id, email: su.email, role: su.role });
            return runTenant(su.tenantId ?? FOUNDING_TENANT_ID, () => next());
          }
        }
      }
      return c.json({ error: "unauthorized" }, 401);
    });
  }

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.issues.join("; ") }, 400);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    return c.json({ error: "internal error" }, 500);
  });

  app.post("/api/auth/login", async (c) => {
    if (!jwtSecret) return c.json({ error: "auth not configured" }, 500);
    const { email, password } = (await jsonBody(c)) ?? {};
    if (!email || !password) return c.json({ error: "email and password required" }, 400);
    const u = await findUserByEmail(email);
    if (!u || !(await verifyPassword(u.password_hash, password))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    const token = signUserToken({ id: u.id, email: u.email, role: u.role }, jwtSecret);
    return c.json({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  });

  app.get("/api/auth/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json(user);
  });

  app.get("/api/skills", async (c) => {
    const status = c.req.query("status") as SkillStatus | undefined;
    return c.json(await listSkills(status));
  });

  app.get("/api/skills/:id", async (c) => {
    const s = await getSkill(c.req.param("id"));
    if (!s) return c.json({ error: "skill not found" }, 404);
    return c.json(s);
  });

  app.post("/api/skills", async (c) => {
    const input = parseNewSkill(await jsonBody(c));
    return c.json(await createSkill(input), 201);
  });

  app.put("/api/skills/:id", async (c) => {
    const patch = parseUpdateSkill(await jsonBody(c));
    return c.json(await updateSkill(c.req.param("id"), patch, "api", undefined));
  });

  app.post("/api/skills/:id/activate", async (c) =>
    c.json(await setStatus(c.req.param("id"), "active")));

  app.post("/api/skills/:id/retire", async (c) =>
    c.json(await setStatus(c.req.param("id"), "retired")));

  app.get("/api/skills/:id/versions", async (c) =>
    c.json(await listVersions(c.req.param("id"))));

  app.get("/api/skills/:id/executions", async (c) =>
    c.json(await listExecutions(c.req.param("id"))));

  // Provenance: connector evidence that produced this skill draft.
  app.get("/api/skills/:id/evidence", async (c) =>
    c.json(await evidenceForDraft("skill", c.req.param("id"))));

  app.get("/api/executions", async (c) => c.json(await listExecutions()));

  // One-shot skill+context lookup for agent harness hooks (see
  // docs/agent-contract.md "Guaranteed invocation").
  app.post("/api/agent/briefing", async (c) => {
    const query = (await jsonBody(c))?.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    const [skills, ctx] = await Promise.all([
      findSkillsWithDistance(query, 1),
      findContextWithDistance(query),
    ]);
    const skillHit = skills[0];
    return c.json({
      skill: skillHit && skillHit.distance <= BRIEFING_MAX_DISTANCE ? skillHit.skill : null,
      context: ctx && ctx.distance <= BRIEFING_MAX_DISTANCE ? ctx.entry : null,
    });
  });

  app.post("/api/skills/:id/draft-from-text", async (c) => {
    const text = (await jsonBody(c))?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ error: "text is required" }, 400);
    }
    return c.json(await draftFromText(text), 201);
  });

  app.post("/api/capture", async (c) => {
    const text = (await jsonBody(c))?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ error: "text is required" }, 400);
    }
    return c.json(await capture(text));
  });

  app.post("/api/ingest/bulk", async (c) => {
    const docs = (await jsonBody(c))?.docs;
    if (!Array.isArray(docs)) return c.json({ error: "docs array is required" }, 400);
    return c.json({ results: await ingestBulk(docs) });
  });

  app.get("/api/context", async (c) => {
    const status = c.req.query("status") as ContextStatus | undefined;
    return c.json(await listContext(status));
  });

  app.get("/api/context/:id", async (c) => {
    const entry = await getContext(c.req.param("id"));
    if (!entry) return c.json({ error: "context not found" }, 404);
    return c.json(entry);
  });

  app.post("/api/context", async (c) => {
    const input = parseNewContext(await jsonBody(c));
    return c.json(await createContext(input), 201);
  });

  app.put("/api/context/:id", async (c) =>
    c.json(await updateContext(c.req.param("id"), parseUpdateContext(await jsonBody(c)), "api")));

  app.post("/api/context/:id/retire", async (c) =>
    c.json(await retireContext(c.req.param("id"))));

  app.get("/api/context/:id/versions", async (c) =>
    c.json(await listContextVersions(c.req.param("id"))));

  const llm = () => opts.llm ?? defaultLlm();
  const sync = opts.sync ?? syncConnector;

  app.post("/api/interviews", async (c) => {
    const { topic, owner } = ((await jsonBody(c)) ?? {}) as { topic?: string; owner?: string };
    if (!topic?.trim()) return c.json({ error: "topic is required" }, 400);
    const iv = await createInterview({
      topic: topic.trim(), owner: owner ?? null, created_by: c.get("user")?.id ?? null,
    });
    return c.json(await runTurn(iv, llm()), 201);
  });

  app.get("/api/interviews", async (c) => c.json(await listInterviews()));

  app.get("/api/interviews/:id", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    return c.json(iv);
  });

  app.post("/api/interviews/:id/messages", async (c) => {
    const content = (await jsonBody(c))?.content;
    if (typeof content !== "string" || !content.trim()) {
      return c.json({ error: "content is required" }, 400);
    }
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    if (iv.status !== "active") return c.json({ error: `interview is ${iv.status}` }, 400);
    const withMsg = await appendInterviewMessage(iv.id, { role: "expert", content: content.trim() });
    return c.json(await runTurn(withMsg, llm()));
  });

  app.post("/api/interviews/:id/approve", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    if (iv.status !== "ready" || !iv.draft) {
      return c.json({ error: "interview has no draft to approve" }, 400);
    }
    const activate = (await jsonBody(c))?.activate !== false;
    let skill = await createSkill(parseNewSkill(iv.draft));
    if (activate) skill = await setStatus(skill.id, "active");
    const interview = await completeInterview(iv.id, skill.id);
    return c.json({ interview, skill });
  });

  app.post("/api/interviews/:id/abandon", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    return c.json(await abandonInterview(iv.id));
  });

  app.post("/api/interviews/:id/resume", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    if (iv.status !== "abandoned") return c.json({ error: `interview is ${iv.status}` }, 400);
    return c.json(await resumeInterview(iv.id));
  });

  app.get("/api/connectors", async (c) =>
    c.json((await listConnectors()).map(publicConnector)));

  app.post("/api/connectors/:type/connect", async (c) => {
    const type = c.req.param("type") as ConnectorType;
    if (!CONNECTOR_TYPES.includes(type)) return c.json({ error: "unknown connector" }, 400);
    const credentials = (await jsonBody(c))?.credentials;
    if (!credentials || typeof credentials !== "object") {
      return c.json({ error: "credentials object is required" }, 400);
    }
    return c.json(publicConnector(await upsertConnector(type, { status: "connected", credentials })));
  });

  app.post("/api/connectors/:type/disable", async (c) => {
    const type = c.req.param("type") as ConnectorType;
    if (!CONNECTOR_TYPES.includes(type)) return c.json({ error: "unknown connector" }, 400);
    return c.json(publicConnector(await upsertConnector(type, { status: "disabled" })));
  });

  app.post("/api/connectors/:type/sync", async (c) => {
    const type = c.req.param("type") as ConnectorType;
    if (!CONNECTOR_TYPES.includes(type)) return c.json({ error: "unknown connector" }, 400);
    try {
      return c.json(await sync(type));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "sync failed" }, 400);
    }
  });

  registerMcpHttp(app);

  return app;
}
