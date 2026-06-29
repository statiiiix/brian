import Fastify, { type FastifyInstance } from "fastify";
import {
  createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions, NotFoundError,
} from "../skills/repo.js";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "../skills/validation.js";
import { listExecutions } from "../feedback/executions.js";
import { draftFromText } from "../ingestion/draftFromText.js";
import type { SkillStatus } from "../skills/types.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

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

  return app;
}
