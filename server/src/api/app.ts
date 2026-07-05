import Fastify, { type FastifyInstance } from "fastify";
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
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { tenantForToken } from "../auth/apiTokens.js";
import {
  createInterview, getInterview, listInterviews, appendMessage as appendInterviewMessage,
  completeInterview, abandonInterview,
} from "../interviews/repo.js";
import { runTurn } from "../interviews/engine.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface AppOptions {
  authToken?: string | null;
  jwtSecret?: string | null;
  llm?: LlmClient;
}

declare module "fastify" {
  interface FastifyRequest { user?: TokenUser }
}

const PUBLIC_PATHS = new Set(["/api/auth/login"]);

// Vector-search hits farther than this cosine distance are treated as
// no-match so hooks don't inject unrelated skills into every prompt.
const BRIEFING_MAX_DISTANCE = 0.6;

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const authToken = opts.authToken ?? null;
  const jwtSecret = opts.jwtSecret ?? null;

  if (authToken || jwtSecret) {
    // Bind the resolved tenant for the whole downstream request via als.run
    // wrapping done() — the reliable Fastify + AsyncLocalStorage pattern (a bare
    // enterWith in a hook does not propagate to the route handler).
    app.addHook("onRequest", (req, reply, done) => {
      const proceed = (tenantId: string) => runTenant(tenantId, () => done());
      const unauthorized = () => reply.code(401).send({ error: "unauthorized" });

      if (PUBLIC_PATHS.has(req.url.split("?")[0])) return done();
      const header = req.headers.authorization;
      // 1) Static founding bearer (BRIAN_API_TOKEN) — the founding tenant.
      if (authToken && bearerMatches(header, authToken)) return proceed(FOUNDING_TENANT_ID);
      if (header?.startsWith("Bearer ")) {
        const raw = header.slice("Bearer ".length);
        // 2) Per-tenant agent token (api_tokens), else 3) dashboard user JWT
        //    (founding tenant in phase 1; Supabase Auth claims carry tenant_id
        //    in phase 3).
        tenantForToken(raw)
          .then((tenantId) => {
            if (tenantId) return proceed(tenantId);
            if (jwtSecret) {
              const u = verifyUserToken(raw, jwtSecret);
              if (u) { req.user = u; return proceed(FOUNDING_TENANT_ID); }
            }
            unauthorized();
          })
          .catch(() => unauthorized());
        return;
      }
      unauthorized();
    });
  }

  app.post("/api/auth/login", async (req, reply) => {
    if (!jwtSecret) return reply.code(500).send({ error: "auth not configured" });
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return reply.code(400).send({ error: "email and password required" });
    const u = await findUserByEmail(email);
    if (!u || !(await verifyPassword(u.password_hash, password))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = signUserToken({ id: u.id, email: u.email, role: u.role }, jwtSecret);
    return { token, user: { id: u.id, email: u.email, name: u.name, role: u.role } };
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthorized" });
    return req.user;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.issues.join("; ") });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    reply.code(500).send({ error: "internal error" });
  });

  app.get("/api/skills", async (req) => {
    const status = (req.query as any)?.status as SkillStatus | undefined;
    return listSkills(status);
  });

  app.get("/api/skills/:id", async (req, reply) => {
    const s = await getSkill((req.params as any).id);
    if (!s) return reply.code(404).send({ error: "skill not found" });
    return s;
  });

  app.post("/api/skills", async (req, reply) => {
    const input = parseNewSkill(req.body);
    const s = await createSkill(input);
    return reply.code(201).send(s);
  });

  app.put("/api/skills/:id", async (req) => {
    const patch = parseUpdateSkill(req.body);
    return updateSkill((req.params as any).id, patch, "api", undefined);
  });

  app.post("/api/skills/:id/activate", async (req) =>
    setStatus((req.params as any).id, "active"));

  app.post("/api/skills/:id/retire", async (req) =>
    setStatus((req.params as any).id, "retired"));

  app.get("/api/skills/:id/versions", async (req) =>
    listVersions((req.params as any).id));

  app.get("/api/skills/:id/executions", async (req) =>
    listExecutions((req.params as any).id));

  app.get("/api/executions", async () => listExecutions());

  // One-shot skill+context lookup for agent harness hooks (see
  // docs/agent-contract.md "Guaranteed invocation").
  app.post("/api/agent/briefing", async (req, reply) => {
    const query = (req.body as any)?.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      return reply.code(400).send({ error: "query is required" });
    }
    const [skills, ctx] = await Promise.all([
      findSkillsWithDistance(query, 1),
      findContextWithDistance(query),
    ]);
    const skillHit = skills[0];
    return {
      skill: skillHit && skillHit.distance <= BRIEFING_MAX_DISTANCE ? skillHit.skill : null,
      context: ctx && ctx.distance <= BRIEFING_MAX_DISTANCE ? ctx.entry : null,
    };
  });

  app.post("/api/skills/:id/draft-from-text", async (req, reply) => {
    const text = (req.body as any)?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return reply.code(400).send({ error: "text is required" });
    }
    const skill = await draftFromText(text);
    return reply.code(201).send(skill);
  });

  app.post("/api/capture", async (req, reply) => {
    const text = (req.body as any)?.text;
    if (typeof text !== "string" || text.trim().length === 0) return reply.code(400).send({ error: "text is required" });
    return capture(text);
  });

  app.post("/api/ingest/bulk", async (req, reply) => {
    const docs = (req.body as any)?.docs;
    if (!Array.isArray(docs)) return reply.code(400).send({ error: "docs array is required" });
    return { results: await ingestBulk(docs) };
  });

  app.get("/api/context", async (req) => {
    const status = (req.query as any)?.status as ContextStatus | undefined;
    return listContext(status);
  });

  app.get("/api/context/:id", async (req, reply) => {
    const c = await getContext((req.params as any).id);
    if (!c) return reply.code(404).send({ error: "context not found" });
    return c;
  });

  app.post("/api/context", async (req, reply) => {
    const input = parseNewContext(req.body);
    return reply.code(201).send(await createContext(input));
  });

  app.put("/api/context/:id", async (req) =>
    updateContext((req.params as any).id, parseUpdateContext(req.body), "api"));

  app.post("/api/context/:id/retire", async (req) =>
    retireContext((req.params as any).id));

  app.get("/api/context/:id/versions", async (req) =>
    listContextVersions((req.params as any).id));

  const llm = () => opts.llm ?? defaultLlm();

  app.post("/api/interviews", async (req, reply) => {
    const { topic, owner } = (req.body ?? {}) as { topic?: string; owner?: string };
    if (!topic?.trim()) return reply.code(400).send({ error: "topic is required" });
    const iv = await createInterview({
      topic: topic.trim(), owner: owner ?? null, created_by: req.user?.id ?? null,
    });
    return reply.code(201).send(await runTurn(iv, llm()));
  });

  app.get("/api/interviews", async () => listInterviews());

  app.get("/api/interviews/:id", async (req, reply) => {
    const iv = await getInterview((req.params as any).id);
    if (!iv) return reply.code(404).send({ error: "interview not found" });
    return iv;
  });

  app.post("/api/interviews/:id/messages", async (req, reply) => {
    const content = (req.body as any)?.content;
    if (typeof content !== "string" || !content.trim()) {
      return reply.code(400).send({ error: "content is required" });
    }
    const iv = await getInterview((req.params as any).id);
    if (!iv) return reply.code(404).send({ error: "interview not found" });
    if (iv.status !== "active") return reply.code(400).send({ error: `interview is ${iv.status}` });
    const withMsg = await appendInterviewMessage(iv.id, { role: "expert", content: content.trim() });
    return runTurn(withMsg, llm());
  });

  app.post("/api/interviews/:id/approve", async (req, reply) => {
    const iv = await getInterview((req.params as any).id);
    if (!iv) return reply.code(404).send({ error: "interview not found" });
    if (iv.status !== "ready" || !iv.draft) {
      return reply.code(400).send({ error: "interview has no draft to approve" });
    }
    const activate = (req.body as any)?.activate !== false;
    let skill = await createSkill(parseNewSkill(iv.draft));
    if (activate) skill = await setStatus(skill.id, "active");
    const interview = await completeInterview(iv.id, skill.id);
    return { interview, skill };
  });

  app.post("/api/interviews/:id/abandon", async (req, reply) => {
    const iv = await getInterview((req.params as any).id);
    if (!iv) return reply.code(404).send({ error: "interview not found" });
    return abandonInterview(iv.id);
  });

  registerMcpHttp(app);

  return app;
}
