import { withTenantTransaction, type TenantTransactionSource } from "../db/tenant.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { CAPTURE_JSON_SCHEMA } from "../llm/schemas.js";
import { parseNewSkill } from "../skills/validation.js";
import { parseNewContext } from "../context/validation.js";
import { skillIsAutoSafe } from "../mcp/toolRisk.js";
import { createSkill, setStatus, updateSkill, findSkillWithDistance } from "../skills/repo.js";
import { createContext, updateContext, findContextWithDistance } from "../context/repo.js";
import { writeAuditEvent } from "../identity/repo.js";
import type { NewSkill } from "../skills/types.js";

export type CapturedItem =
  | { kind: "context"; confidence: number; content: string; summary: string; tags: string[] }
  | { kind: "skill"; confidence: number; skill: NewSkill };

export interface CaptureResult {
  items: Array<{ kind: "skill" | "context"; action: string; id: string; confidence: number }>;
}

const CONF_MIN = Number(process.env.CAPTURE_CONFIDENCE_MIN ?? 0.75);
const SIM_MAX = Number(process.env.CAPTURE_SIM_MAX ?? 0.2);

const SYSTEM = `You extract structured knowledge from a work session transcript into a list of items.
Classify each item as "context" (a goal, decision, preference, or fact that informs future work)
or "skill" (a repeatable process with steps the team follows). Give each item a confidence 0..1.
For skills, fill procedure, hard_rules, tools, guardrails, and escalation_target from the text;
leave fields empty or null when the text does not specify them.`;

// Robust to either a bare array or a { items: [...] } wrapper (Structured Outputs
// requires an object root, so live calls return the wrapper; test fakes may return
// a bare array).
function extractItems(text: string): unknown[] {
  const tryParse = (s: string): unknown => {
    try { return JSON.parse(s); } catch { return undefined; }
  };
  let parsed = tryParse(text.trim());
  if (parsed === undefined) {
    const brace = text.indexOf("{");
    const bracket = text.indexOf("[");
    const start = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (start === -1 || end === -1) throw new Error("model returned no JSON");
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray((parsed as { items?: unknown[] }).items)) {
    return (parsed as { items: unknown[] }).items;
  }
  throw new Error("model output missing items array");
}

export async function capture(
  text: string, llm: LlmClient = defaultLlm(), p?: TenantTransactionSource,
): Promise<CaptureResult> {
  const out = await llm.complete({
    system: SYSTEM,
    user: `Extract from this session:\n\n${text}`,
    schema: { name: "captured_items", schema: CAPTURE_JSON_SCHEMA },
  });
  const raw = extractItems(out);

  return withTenantTransaction(async (client) => {
    const items: CaptureResult["items"] = [];
    const add = async (item: CaptureResult["items"][number]) => {
      const operation = item.action.startsWith("updated") ? "updated" : "created";
      await writeAuditEvent(`knowledge.capture.${operation}`, {
        targetType: item.kind,
        targetId: item.id,
        // Captured source text and model output are intentionally excluded.
        metadata: { action: item.action, confidence: item.confidence },
      }, client);
      items.push(item);
    };
    for (const r of raw as CapturedItem[]) {
      if (r.kind === "context") {
        const input = parseNewContext({ content: r.content, summary: r.summary, tags: r.tags, source: "capture", owner: null });
        const match = await findContextWithDistance(input.summary ?? input.content, client);
        if (match && match.distance <= SIM_MAX) {
          const u = await updateContext(match.entry.id, input, "capture", client);
          await add({ kind: "context", action: "updated_active", id: u.id, confidence: r.confidence });
        } else {
          const cre = await createContext(input, client);
          await add({ kind: "context", action: "created_active", id: cre.id, confidence: r.confidence });
        }
      } else {
        const skill = parseNewSkill(r.skill);
        const auto = r.confidence >= CONF_MIN && skillIsAutoSafe(skill.tools);
        const match = await findSkillWithDistance(`${skill.name}\n${skill.trigger}`, client);
        const isUpdate = match !== null && match.distance <= SIM_MAX;
        if (isUpdate && auto) {
          const u = await updateSkill(match!.skill.id, skill, "capture", client);
          const a = await setStatus(u.id, "active", client);
          await add({ kind: "skill", action: "updated_active", id: a.id, confidence: r.confidence });
        } else {
          const cre = await createSkill(skill, client); // draft
          if (!isUpdate && auto) {
            const a = await setStatus(cre.id, "active", client);
            await add({ kind: "skill", action: "created_active", id: a.id, confidence: r.confidence });
          } else {
            await add({ kind: "skill", action: isUpdate ? "proposed_draft" : "created_draft", id: cre.id, confidence: r.confidence });
          }
        }
      }
    }
    return { items };
  }, p);
}
