import { z } from "zod";
import type { NewSkill } from "./types.js";

export class ValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super("validation failed");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

const exampleSchema = z.object({
  scenario: z.string().min(1),
  correct_action: z.string().min(1),
});

const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().nullable(),
  origin: z.enum(["company", "expert", "web"]),
});

export const newSkillSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  inputs: z.array(z.string()).default([]),
  procedure: z.string().min(1),
  hard_rules: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  guardrails: z.array(z.string()).default([]),
  escalation_target: z.string().nullable().default(null),
  examples: z.array(exampleSchema).default([]),
  owner: z.string().nullable().default(null),
  principles: z.array(z.string().min(1)).default([]),
  quality_checks: z.array(z.string().min(1)).default([]),
  sources: z.array(sourceSchema).default([]),
});

export const updateSkillSchema = newSkillSchema.partial();

function format(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export function parseNewSkill(body: unknown): NewSkill {
  const r = newSkillSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as NewSkill;
}

export function parseUpdateSkill(body: unknown): Partial<NewSkill> {
  const r = updateSkillSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as Partial<NewSkill>;
}
