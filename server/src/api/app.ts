import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions, NotFoundError,
} from "../skills/repo.js";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "../skills/validation.js";
import { listExecutions } from "../feedback/executions.js";
import { draftFromText } from "../ingestion/draftFromText.js";
import type { SkillStatus } from "../skills/types.js";
import { createContext, getContext, listContext, updateContext, retireContext, listContextVersions } from "../context/repo.js";
import { parseNewContext, parseUpdateContext } from "../context/validation.js";
import { capture } from "../ingestion/capture.js";
import { ingestBulk } from "../ingestion/bulk.js";
import type { ContextStatus } from "../context/types.js";

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface AppOptions {
  authToken?: string | null;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const authToken = opts.authToken ?? null;

  if (authToken) {
    app.addHook("onRequest", async (req, reply) => {
      if (!bearerMatches(req.headers.authorization, authToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
  }

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

  return app;
}
