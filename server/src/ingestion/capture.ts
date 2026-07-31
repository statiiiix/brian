import { withTenantTransaction, type TenantTransactionSource } from "../db/tenant.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { CAPTURE_JSON_SCHEMA } from "../llm/schemas.js";
import { parseNewSkill } from "../skills/validation.js";
import { parseNewContext } from "../context/validation.js";
import { skillIsAutoSafe } from "../mcp/toolRisk.js";
import {
  createSkill, getSkill, setStatus, updateSkill, findSkillsWithDistanceAnyStatus,
  NotFoundError,
} from "../skills/repo.js";
import { createContext, updateContext, findContextWithDistance } from "../context/repo.js";
import { writeAuditEvent } from "../identity/repo.js";
import {
  routeCapture, captureThresholdsFromEnv,
  type CaptureCandidate, type CaptureRoute,
} from "./routing.js";
import type { NewSkill } from "../skills/types.js";
import type { NewContext } from "../context/types.js";

export type CapturedItem =
  | { kind: "context"; confidence: number; content: string; summary: string; tags: string[] }
  | { kind: "skill"; confidence: number; skill: NewSkill };

export interface CaptureResult {
  items: Array<{ kind: "skill" | "context"; action: string; id: string; confidence: number }>;
}

/**
 * What capture intends to do, before anything is written. Produced by
 * proposeCapture (reads only) so a caller with a human present can override the
 * routing before commitCapture applies it.
 */
export type CaptureProposal =
  | {
      kind: "context";
      confidence: number;
      input: NewContext;
      /** Context has no grey zone: it is merged when close, created otherwise. */
      route: { kind: "merge"; targetId: string } | { kind: "create" };
    }
  | {
      kind: "skill";
      confidence: number;
      input: NewSkill;
      /**
       * Whether this skill could be applied without review at all: confident
       * enough, and touching only reversible tools.
       */
      auto: boolean;
      route: CaptureRoute;
    };

export type CaptureChoice =
  | { action: "create" }
  | {
      action: "merge";
      targetId: string;
      /**
       * Force the merge through the review queue as a proposal draft rather
       * than applying it. Set for human-directed merges: picking a target in a
       * dialog is a routing decision, not a review of the wording.
       */
      review?: boolean;
    };

/** Choices by index into the proposal list. Missing entries take the default. */
export type CaptureChoices = Record<number, CaptureChoice>;

const CONF_MIN = Number(process.env.CAPTURE_CONFIDENCE_MIN ?? 0.75);

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

/**
 * Read-only first half of capture: classify the text, validate each item, and
 * work out where it would go. Writes nothing, so the result can be shown to a
 * human and amended before commitCapture applies it.
 */
export async function proposeCapture(
  text: string,
  llm: LlmClient = defaultLlm(),
  p?: TenantTransactionSource,
): Promise<CaptureProposal[]> {
  const out = await llm.complete({
    system: SYSTEM,
    user: `Extract from this session:\n\n${text}`,
    schema: { name: "captured_items", schema: CAPTURE_JSON_SCHEMA },
  });
  const raw = extractItems(out) as CapturedItem[];
  const thresholds = captureThresholdsFromEnv();

  return withTenantTransaction(async (client) => {
    const proposals: CaptureProposal[] = [];
    for (const r of raw) {
      if (r.kind === "context") {
        const input = parseNewContext({
          content: r.content, summary: r.summary, tags: r.tags, source: "capture", owner: null,
        });
        const match = await findContextWithDistance(input.summary ?? input.content, client);
        proposals.push({
          kind: "context",
          confidence: r.confidence,
          input,
          route: match && match.distance <= thresholds.simMax
            ? { kind: "merge", targetId: match.entry.id }
            : { kind: "create" },
        });
      } else {
        const input = parseNewSkill(r.skill);
        const hits = await findSkillsWithDistanceAnyStatus(
          `${input.name}\n${input.trigger}`, thresholds.maxCandidates, client,
        );
        const candidates: CaptureCandidate[] = hits.map(({ skill, distance }) => ({
          id: skill.id, name: skill.name, trigger: skill.trigger,
          status: skill.status, distance,
        }));
        proposals.push({
          kind: "skill",
          confidence: r.confidence,
          input,
          auto: r.confidence >= CONF_MIN && skillIsAutoSafe(input.tools),
          route: routeCapture(candidates, thresholds),
        });
      }
    }
    return proposals;
  }, p);
}

/**
 * What capture does with a proposal when nobody answers: exactly what it did
 * before the split — merge only on a confident distance match, otherwise create.
 * An unresolved grey-zone item therefore falls back to today's behaviour rather
 * than being dropped.
 */
export function defaultChoice(proposal: CaptureProposal): CaptureChoice {
  if (proposal.kind === "context") {
    return proposal.route.kind === "merge"
      ? { action: "merge", targetId: proposal.route.targetId }
      : { action: "create" };
  }
  return proposal.route.kind === "merge"
    ? { action: "merge", targetId: proposal.route.target.id }
    : { action: "create" };
}

/**
 * Write half of capture. Re-validates every input rather than trusting the
 * proposal it is handed back: the round trip goes through a browser.
 */
export async function commitCapture(
  proposals: CaptureProposal[],
  choices: CaptureChoices = {},
  p?: TenantTransactionSource,
): Promise<CaptureResult> {
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

    for (const [index, proposal] of proposals.entries()) {
      const choice = choices[index] ?? defaultChoice(proposal);

      if (proposal.kind === "context") {
        const input = parseNewContext({ ...proposal.input, source: "capture" });
        if (choice.action === "merge") {
          const u = await updateContext(choice.targetId, input, "capture", client);
          await add({ kind: "context", action: "updated_active", id: u.id, confidence: proposal.confidence });
        } else {
          const cre = await createContext(input, client);
          await add({ kind: "context", action: "created_active", id: cre.id, confidence: proposal.confidence });
        }
        continue;
      }

      const skill = parseNewSkill(proposal.input);
      const auto = proposal.confidence >= CONF_MIN && skillIsAutoSafe(skill.tools);

      if (choice.action === "merge") {
        // The target arrives from the client on the human path, so confirm it
        // is a skill in this tenant before pointing anything at it.
        if (!(await getSkill(choice.targetId, client))) throw new NotFoundError(choice.targetId);
        // A merge the human asked for always goes to review, even when the
        // skill would otherwise qualify to apply itself.
        if (auto && !choice.review) {
          const u = await updateSkill(choice.targetId, skill, "capture", client);
          const a = await setStatus(u.id, "active", client);
          await add({ kind: "skill", action: "updated_active", id: a.id, confidence: proposal.confidence });
        } else {
          const cre = await createSkill(skill, client, choice.targetId);
          await add({ kind: "skill", action: "proposed_draft", id: cre.id, confidence: proposal.confidence });
        }
        continue;
      }

      const cre = await createSkill(skill, client);
      if (auto) {
        const a = await setStatus(cre.id, "active", client);
        await add({ kind: "skill", action: "created_active", id: a.id, confidence: proposal.confidence });
      } else {
        await add({ kind: "skill", action: "created_draft", id: cre.id, confidence: proposal.confidence });
      }
    }
    return { items };
  }, p);
}

/**
 * Fully automatic capture: what agents get over MCP, where there is no human to
 * ask. Unchanged in behaviour by the propose/commit split.
 */
export async function capture(
  text: string, llm: LlmClient = defaultLlm(), p?: TenantTransactionSource,
): Promise<CaptureResult> {
  const proposals = await proposeCapture(text, llm, p);
  return commitCapture(proposals, {}, p);
}
