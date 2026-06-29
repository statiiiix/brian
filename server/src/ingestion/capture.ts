import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { parseNewSkill } from "../skills/validation.js";
import { parseNewContext } from "../context/validation.js";
import { skillIsAutoSafe } from "../mcp/toolRisk.js";
import { createSkill, setStatus, updateSkill, findSkillWithDistance } from "../skills/repo.js";
import { createContext, updateContext, findContextWithDistance } from "../context/repo.js";
import type { NewSkill } from "../skills/types.js";

export type CapturedItem =
  | { kind: "context"; confidence: number; content: string; summary: string; tags: string[] }
  | { kind: "skill"; confidence: number; skill: NewSkill };

export interface CaptureResult {
  items: Array<{ kind: "skill" | "context"; action: string; id: string; confidence: number }>;
}

const CONF_MIN = Number(process.env.CAPTURE_CONFIDENCE_MIN ?? 0.75);
const SIM_MAX = Number(process.env.CAPTURE_SIM_MAX ?? 0.2);

const SYSTEM = `You extract structured knowledge from a work session transcript.
Return ONLY a JSON array. Each element is one of:
{"kind":"context","confidence":0..1,"content":"...","summary":"short","tags":["..."]}
{"kind":"skill","confidence":0..1,"skill":{"name","trigger","inputs":[],"procedure",
  "hard_rules":[],"tools":[],"guardrails":[],"escalation_target":null,"examples":[],"owner":null}}
Use "context" for goals/decisions/preferences/facts. Use "skill" for repeatable
processes with steps. No prose, no markdown fences.`;

function extractArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("model returned no JSON array");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("model output is not an array");
  return parsed;
}

export async function capture(
  text: string, llm: LlmClient = defaultLlm(), p: pg.Pool = defaultPool
): Promise<CaptureResult> {
  const out = await llm.complete({
    system: SYSTEM,
    user: `Extract from this session:\n\n${text}`,
    maxTokens: 4000,
  });
  const raw = extractArray(out);

  const items: CaptureResult["items"] = [];
  for (const r of raw as CapturedItem[]) {
    if (r.kind === "context") {
      const input = parseNewContext({ content: r.content, summary: r.summary, tags: r.tags, source: "capture", owner: null });
      const match = await findContextWithDistance(input.summary ?? input.content, p);
      if (match && match.distance <= SIM_MAX) {
        const u = await updateContext(match.entry.id, input, "capture", p);
        items.push({ kind: "context", action: "updated_active", id: u.id, confidence: r.confidence });
      } else {
        const cre = await createContext(input, p);
        items.push({ kind: "context", action: "created_active", id: cre.id, confidence: r.confidence });
      }
    } else {
      const skill = parseNewSkill(r.skill);
      const auto = r.confidence >= CONF_MIN && skillIsAutoSafe(skill.tools);
      const match = await findSkillWithDistance(`${skill.name}\n${skill.trigger}`, p);
      const isUpdate = match !== null && match.distance <= SIM_MAX;
      if (isUpdate && auto) {
        const u = await updateSkill(match!.skill.id, skill, "capture", p);
        const a = await setStatus(u.id, "active", p);
        items.push({ kind: "skill", action: "updated_active", id: a.id, confidence: r.confidence });
      } else {
        const cre = await createSkill(skill, p); // draft
        if (!isUpdate && auto) {
          const a = await setStatus(cre.id, "active", p);
          items.push({ kind: "skill", action: "created_active", id: a.id, confidence: r.confidence });
        } else {
          items.push({ kind: "skill", action: isUpdate ? "proposed_draft" : "created_draft", id: cre.id, confidence: r.confidence });
        }
      }
    }
  }
  return { items };
}
