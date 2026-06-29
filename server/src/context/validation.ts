import { z } from "zod";
import { ValidationError } from "../skills/validation.js";
import type { NewContext } from "./types.js";

export const newContextSchema = z.object({
  content: z.string().min(1),
  summary: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  source: z.string().nullable().default(null),
  owner: z.string().nullable().default(null),
});

export const updateContextSchema = newContextSchema.partial();

function format(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export function parseNewContext(body: unknown): NewContext {
  const r = newContextSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as NewContext;
}

export function parseUpdateContext(body: unknown): Partial<NewContext> {
  const r = updateContextSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as Partial<NewContext>;
}
