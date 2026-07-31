import { z } from "zod";
import { withTenantTransaction, type TenantTransactionSource } from "../db/tenant.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { INTERVIEW_TURN_JSON_SCHEMA } from "../llm/schemas.js";
import { parseNewSkill } from "../skills/validation.js";
import { appendMessage, setTurnResult } from "./repo.js";
import { defaultResearchClient, type ResearchClient, type ResearchResult } from "./research.js";
import { addWebResearchSources, replaceInterviewEvidence } from "./sources.js";
import { sourceMaterialPrompt } from "./sourceGuidance.js";
import { normalizeCoverage } from "./types.js";
import type { Interview, InterviewEvidence, InterviewSource, SkillDraft } from "./types.js";

// A cap, not a target. Real interviews ran to 19 messages and were abandoned
// two thirds of the time; the readiness gate ends most of them well before
// this, and a draft-first opening removes the questions sources can answer.
export const MAX_QUESTIONS = 12;

const PARSER_SYSTEM = `You are the hidden skill analyst behind an AI-led interview.
Read the full conversation and source material, then maintain the structured skill state.
You never speak to the expert. Set question to null; the conversational interviewer is a
separate AI. Extract only what the conversation and sources support.
Treat vague answers such as "anything", "whatever is needed", or a category name without
specific inputs or decisions as missing, not defined. A source that explains a methodology
does not explain how the company wants to apply it.
For every component return defined, not_applicable, or missing. not_applicable requires a
specific reason. Guardrails, hard rules, approval limits, departments, and escalation are
OPTIONAL: never invent bureaucracy or heavy controls just to fill fields. If the expert
clearly says controls are unnecessary, resolve hard rules, guardrails, and escalation
together when that is supported by the conversation.
Maintain a living draft on every turn. Separate company sources, expert decisions, and web
research in evidence. External guidance is not company policy unless the expert confirms it.
Set research_query only when an important factual or methodological gap genuinely needs
external information; otherwise set it to null. When all relevant components are resolved and
the draft is executable, return ready. Executable means concrete inputs, recognizable
principles, step-by-step decisions, at least two quality checks, and at least two worked
examples. Do not invent policy the expert did not state.`;

const INTERVIEWER_SYSTEM = `You are Brian, an intelligent thought partner helping someone
build a skill for an AI agent. Lead a natural conversation. Do not behave like a form, rubric,
or database-field collector, and never mention coverage states or hidden parsing.

On the opening turn, warmly acknowledge what the expert already told you — the skill's name,
what it is for, and its owner when those were given — and never ask them to repeat any of it.
Open with a single focused question about the first thing they have not specified yet: usually
how the work actually gets done, the judgment it takes, or what a great result looks like. Only
when almost nothing was given should you fall back to inviting them to explain in their own
words what the skill should do and who it is for.

On later turns, first respond to what the expert actually said. Briefly reflect useful
understanding, answer their question, or repair a misunderstanding. Then ask one thoughtful
follow-up that naturally deepens the skill. You may use a few conversational sentences before
the question. Do not fire disconnected checklist questions.

Move naturally from intent and desired outcome, to source principles and how they apply, to
real workflow and judgment, then quality and examples. Only discuss rules, approvals,
guardrails, or escalation near the end and only if meaningful risk makes them relevant. If the
expert says those controls are unnecessary, accept it and move on without rephrasing the same
question. Use the hidden draft and gaps as guidance, not as a script. Return only the message
the expert should see.

Write in light Markdown: a blank line between paragraphs, **bold** on the few words that carry
the point, and a short bullet list when you lay out options or read something back. Keep it
conversational — most turns are one or two short paragraphs ending in a question. Use a heading
only when a message genuinely covers several parts, and never format a single question.`;

type ReadinessComponent = keyof z.infer<typeof coverageSchema>;

interface ReadinessIssue {
  component: ReadinessComponent;
  detail: string;
}

const COMPONENTS: ReadinessComponent[] = [
  "trigger", "inputs", "principles", "procedure", "tools", "hard_rules",
  "guardrails", "escalation_target", "quality_checks", "examples",
];

const ALWAYS_MATERIAL = new Set<ReadinessComponent>([
  "trigger", "inputs", "procedure", "quality_checks", "examples",
]);

const componentSchema = z.object({
  status: z.enum(["defined", "not_applicable", "missing"]),
  summary: z.string().nullable(),
  reason: z.string().nullable(),
});
const coverageSchema = z.object({
  trigger: componentSchema, inputs: componentSchema, principles: componentSchema,
  procedure: componentSchema, tools: componentSchema, hard_rules: componentSchema,
  guardrails: componentSchema, escalation_target: componentSchema,
  quality_checks: componentSchema, examples: componentSchema,
});
const sourceRefSchema = z.object({
  title: z.string(), url: z.string().nullable(),
  origin: z.enum(["company", "expert", "web"]),
});
const draftSchema = z.object({
  name: z.string().nullable(), trigger: z.string().nullable(),
  inputs: z.array(z.string()), principles: z.array(z.string()),
  procedure: z.string().nullable(), hard_rules: z.array(z.string()),
  tools: z.array(z.string()), guardrails: z.array(z.string()),
  escalation_target: z.string().nullable(), quality_checks: z.array(z.string()),
  examples: z.array(z.object({ scenario: z.string(), correct_action: z.string() })),
  sources: z.array(sourceRefSchema), owner: z.string().nullable(),
});
const evidenceSchema = z.object({
  component: z.enum([
    "trigger", "inputs", "principles", "procedure", "tools", "hard_rules",
    "guardrails", "escalation_target", "quality_checks", "examples",
  ]),
  statement: z.string(), origin: z.enum(["company", "expert", "web"]),
  source_title: z.string().nullable(), source_url: z.string().nullable(),
});
const turnSchema = z.object({
  status: z.enum(["asking", "ready"]),
  question: z.string().nullable(),
  coverage: coverageSchema,
  draft: draftSchema.nullable(),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  research_query: z.string().nullable(),
  evidence: z.array(evidenceSchema),
});

function readinessIssues(
  turn: z.infer<typeof turnSchema>, hasCompanySources: boolean,
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  for (const component of COMPONENTS) {
    const state = turn.coverage[component];
    if (state.status === "missing") {
      issues.push({ component, detail: `${component} is still missing` });
      continue;
    }
    if (state.status === "not_applicable" && !state.reason?.trim()) {
      issues.push({ component, detail: `${component} needs a concrete not-applicable reason` });
      continue;
    }
    if (state.status === "defined" && !state.summary?.trim()) {
      issues.push({ component, detail: `${component} is marked defined without a concrete summary` });
    }
  }

  for (const component of ALWAYS_MATERIAL) {
    if (turn.coverage[component].status === "not_applicable") {
      issues.push({ component, detail: `${component} is required for an executable skill` });
    }
  }
  if (hasCompanySources && turn.coverage.principles.status !== "defined") {
    issues.push({ component: "principles", detail: "selected source principles have not been applied" });
  }

  const draft = turn.draft;
  if (!draft) return [{ component: "procedure", detail: "the living draft is missing" }, ...issues];
  if (!draft.trigger?.trim() || draft.trigger.trim().length < 20) {
    issues.push({ component: "trigger", detail: "the trigger and completion outcome are not concrete" });
  }
  if (draft.inputs.length === 0 || draft.inputs.some((input) => input.trim().length < 4)) {
    issues.push({ component: "inputs", detail: "the required inputs are not concrete" });
  }
  if (hasCompanySources && draft.principles.length < 2) {
    issues.push({ component: "principles", detail: "the draft needs at least two source-specific principles" });
  }
  if (!draft.procedure?.trim() || draft.procedure.trim().length < 160) {
    issues.push({ component: "procedure", detail: "the procedure lacks executable step-by-step detail" });
  }
  if (draft.quality_checks.length < 2) {
    issues.push({ component: "quality_checks", detail: "the draft needs at least two concrete quality checks" });
  }
  if (draft.examples.length < 2 || draft.examples.some((example) =>
    example.scenario.trim().length < 20 || example.correct_action.trim().length < 30)) {
    issues.push({ component: "examples", detail: "the draft needs at least two detailed worked examples" });
  }
  if (hasCompanySources && !draft.sources.some((source) => source.origin === "company")) {
    issues.push({ component: "principles", detail: "the selected company source is not cited in the draft" });
  }
  return issues;
}

function readinessQuestion(
  issues: ReadinessIssue[], iv: Interview, sources: InterviewSource[],
): string {
  const issue = issues.find((candidate) => candidate.component === "principles") ?? issues[0];
  const sourceTitle = sources.find((source) => source.kind === "connector")?.title
    ?? iv.source_context?.documents[0]?.title;
  const questions: Record<ReadinessComponent, string> = {
    trigger: "What exact request or event should trigger this skill, and what observable result means the task is done?",
    inputs: "Before starting, what specific information must the agent collect instead of guessing?",
    principles: sourceTitle
      ? `Which ${sourceTitle} principles matter most here, and how should each one change the agent's decisions for ${iv.topic}?`
      : `Which principles should guide the agent's judgment for ${iv.topic}, and how should they change its decisions?`,
    procedure: `Walk me through one real ${iv.topic} task from request to final output, including the decisions made at each step.`,
    tools: "Which tools or source systems should the agent use, and which can it work without?",
    hard_rules: "Are there any absolute rules here, or should hard rules be marked not applicable?",
    guardrails: "Are there any situations where the agent must stop, or should guardrails be marked not applicable?",
    escalation_target: "If nothing needs escalation, should this be explicitly marked not applicable?",
    quality_checks: "Before publishing the work, what concrete checks prove it is strong, distinctive, accurate, and on-brand?",
    examples: "Give me one realistic task and describe what an excellent final result would do differently from an ordinary one.",
  };
  return questions[issue.component];
}

const legacyTurnSchema = z.object({
  status: z.enum(["asking", "ready"]),
  question: z.string().nullable(),
  coverage: z.object({
    trigger: z.boolean(), inputs: z.boolean(), procedure: z.boolean(),
    hard_rules: z.boolean(), guardrails: z.boolean(),
    escalation_target: z.boolean(), examples: z.boolean(),
  }),
  draft: z.unknown().nullable(),
});

function parseTurnOutput(raw: unknown): z.infer<typeof turnSchema> {
  const modern = turnSchema.safeParse(raw);
  if (modern.success) return modern.data;
  const legacy = legacyTurnSchema.parse(raw);
  const oldDraft = legacy.draft as Record<string, unknown> | null;
  const draft = oldDraft ? draftSchema.parse({
    ...oldDraft,
    principles: oldDraft.principles ?? [],
    quality_checks: oldDraft.quality_checks ?? [],
    sources: oldDraft.sources ?? [],
  }) : null;
  return {
    status: legacy.status,
    question: legacy.question,
    coverage: normalizeCoverage(legacy.coverage),
    draft,
    assumptions: [],
    warnings: [],
    research_query: null,
    evidence: [],
  };
}

function sourceMaterial(iv: Interview, sources: InterviewSource[] = []): string {
  return sourceMaterialPrompt(iv.source_context, sources);
}

// "Anyone" is how the builder UI records "no single owner"; older interviews
// stored the literal word, so never surface it to the models as a person.
function ownerName(iv: Interview): string | null {
  const owner = iv.owner?.trim();
  return owner && owner.toLowerCase() !== "anyone" ? owner : null;
}

// The name, purpose, and owner the expert entered on the build form travel in
// `topic` (first line is the title, later lines are the labelled brief). Surface
// them plainly so the interviewer acknowledges them instead of re-collecting
// what the expert already answered.
function knownContext(iv: Interview): string {
  const details = String(iv.topic ?? "")
    .split("\n").slice(1).map((line) => line.trim()).filter(Boolean);
  const owner = ownerName(iv);
  const lines = [
    ...details.map((line) => `- ${line}`),
    owner && !details.some((line) => /^owner\b/i.test(line)) ? `- Owner: ${owner}` : "",
  ].filter(Boolean);
  return lines.length
    ? `The expert already provided this when starting — do not ask them to repeat it:\n${lines.join("\n")}`
    : "";
}

function topicTitle(iv: Interview): string {
  return String(iv.topic ?? "").split("\n")[0]?.trim() || String(iv.topic ?? "");
}

export function buildUser(
  iv: Interview, forceFinish: boolean, sources: InterviewSource[] = [],
  research?: ResearchResult,
): string {
  const transcript = iv.messages
    .map((m) => `${m.role === "brian" ? "Brian" : "Expert"}: ${m.content}`)
    .join("\n");
  const owner = ownerName(iv);
  return [
    `Process being captured: ${iv.topic}`,
    owner ? `Process owner: ${owner}` : "",
    sourceMaterial(iv, sources),
    research ? `External web research (informational, not company policy):\n${research.summary}\n\nCitations:\n${research.citations.map((citation) => `- ${citation.title}: ${citation.url}`).join("\n")}` : "",
    transcript ? `Transcript so far:\n${transcript}` : "No questions asked yet — open the interview.",
    forceFinish
      ? 'You have reached the question limit. FINISH NOW: return status "ready" with your best complete draft from the transcript.'
      : "",
  ].filter(Boolean).join("\n\n");
}

// The hidden parser does the judgement-heavy structured work; the interviewer
// only has to talk well, so it runs at a cheaper reasoning effort.
const PARSER_EFFORT = "medium" as const;
const INTERVIEWER_EFFORT = "low" as const;

async function completeTurn(
  llm: LlmClient, user: string,
): Promise<z.infer<typeof turnSchema>> {
  const args = {
    system: PARSER_SYSTEM,
    user,
    schema: { name: "interview_turn", schema: INTERVIEW_TURN_JSON_SCHEMA },
    effort: PARSER_EFFORT,
  };
  let parsed: z.infer<typeof turnSchema> | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      parsed = parseTurnOutput(JSON.parse(await llm.complete(args)));
    } catch (error) {
      lastErr = error;
    }
  }
  if (!parsed) throw new Error(`interview turn failed: ${String(lastErr)}`);
  return parsed;
}

// Used only when the conversational model is unavailable, so creating an
// interview never fails on a transient LLM error.
function fallbackOpening(iv: Interview, sources: InterviewSource[]): string {
  const title = sources.find((source) => source.status === "ready")?.title
    ?? iv.source_context?.documents[0]?.title;
  return title
    ? `I've read ${title}. Before I use it, tell me in your own words what this skill should do for ${iv.topic}, who will rely on it, and what a great result looks like.`
    : `Let's build this together. In your own words, what should this skill do for ${iv.topic}, who will use it, and what does a great result look like?`;
}

export function buildInterviewerUser(
  iv: Interview, sources: InterviewSource[],
  opts: { research?: ResearchResult; guidance?: string[]; forceFinish?: boolean } = {},
): string {
  const transcript = iv.messages
    .map((m) => `${m.role === "brian" ? "Brian" : "Expert"}: ${m.content}`)
    .join("\n");
  return [
    `Skill being built: ${topicTitle(iv)}`,
    knownContext(iv),
    sourceMaterial(iv, sources),
    opts.research
      ? `External web research you may reference as outside guidance, never as company policy:\n${opts.research.summary}`
      : "",
    transcript
      ? `Conversation so far:\n${transcript}`
      : "The conversation has not started yet — open it.",
    opts.guidance?.length
      ? `Private notes from your own analysis — never quote, list, or mention these. Let the most important one shape your next question:\n${opts.guidance.map((note) => `- ${note}`).join("\n")}`
      : "",
    opts.forceFinish
      ? "This is the last exchange before the skill is finalized. Ask for the single most valuable missing detail."
      : "",
  ].filter(Boolean).join("\n\n");
}

async function speak(
  llm: LlmClient, iv: Interview, sources: InterviewSource[],
  opts: { research?: ResearchResult; guidance?: string[]; forceFinish?: boolean },
  fallback: string,
): Promise<string> {
  try {
    const message = (await llm.complete({
      system: INTERVIEWER_SYSTEM,
      user: buildInterviewerUser(iv, sources, opts),
      effort: INTERVIEWER_EFFORT,
    })).trim();
    return message || fallback;
  } catch {
    return fallback;
  }
}

// Completes the interview from whatever the parser has: validates the draft,
// stores the evidence, and marks the interview ready. parseNewSkill throws a
// ValidationError when the draft is too thin to become a skill, which callers
// surface instead of stranding the expert.
async function persistReady(
  iv: Interview, parsed: z.infer<typeof turnSchema>, evidence: InterviewEvidence[],
  warnings: string[], p?: TenantTransactionSource,
): Promise<Interview> {
  const raw = (parsed.draft ?? {}) as Record<string, unknown>;
  const completeDraft = parseNewSkill({ ...raw, owner: raw.owner ?? ownerName(iv) });
  const draft: SkillDraft = {
    name: completeDraft.name,
    trigger: completeDraft.trigger,
    inputs: completeDraft.inputs,
    principles: completeDraft.principles ?? [],
    procedure: completeDraft.procedure,
    hard_rules: completeDraft.hard_rules,
    tools: completeDraft.tools,
    guardrails: completeDraft.guardrails,
    escalation_target: completeDraft.escalation_target,
    quality_checks: completeDraft.quality_checks ?? [],
    examples: completeDraft.examples,
    sources: completeDraft.sources ?? [],
    owner: completeDraft.owner,
  };
  return withTenantTransaction(async (client) => {
    await replaceInterviewEvidence(iv.id, evidence, client);
    return setTurnResult(iv.id, {
      coverage: parsed.coverage, draft, ready: true,
      assumptions: parsed.assumptions, warnings,
    }, client);
  }, p);
}

// The expert's own "we're done". The readiness gate stops the model from
// finishing early; it must never stop the person being interviewed, so this
// synthesizes a final draft from the conversation on demand.
/** Whether the interview has company material worth drafting from up front. */
function hasGrounding(iv: Interview, sources: InterviewSource[]): boolean {
  return sources.some(
    (source) => (source.kind === "connector" || source.kind === "upload") && source.status === "ready",
  ) || Boolean(iv.source_context?.documents.length);
}

/**
 * Opening turn for a source-grounded interview: parse the sources into a draft,
 * store it so the expert can see and edit it immediately, then open the
 * conversation on the gaps the sources genuinely left open. Never finishes the
 * interview — a draft nobody has confirmed is not an approved procedure.
 */
async function openFromSources(
  iv: Interview, llm: LlmClient, sources: InterviewSource[], p?: TenantTransactionSource,
): Promise<Interview> {
  let parsed: z.infer<typeof turnSchema> | null = null;
  try {
    parsed = await completeTurn(llm, buildUser(iv, false, sources));
  } catch {
    // A failed pre-read must not block the interview from starting.
    parsed = null;
  }

  if (!parsed) {
    const opening = await speak(llm, iv, sources, {}, fallbackOpening(iv, sources));
    return appendMessage(iv.id, { role: "brian", content: opening }, p);
  }

  const gaps: ReadinessIssue[] = COMPONENTS
    .filter((component) => parsed.coverage[component].status === "missing")
    .map((component) => ({ component, detail: `${component} is still missing` }));
  const draft = parsed.draft as SkillDraft | null;
  const opening = await speak(llm, iv, sources, {
    guidance: [
      draft
        ? "You have already drafted this skill from their own material. Open by telling them"
          + " what you drafted in one or two sentences, then ask about the single most"
          + " important thing the sources could not tell you."
        : "You have read their material but it was not enough to draft from. Open by saying"
          + " what you took from it, then ask the most important open question.",
      ...gaps.map((gap) => gap.detail),
    ],
  }, fallbackOpening(iv, sources));

  return withTenantTransaction(async (client) => {
    await replaceInterviewEvidence(iv.id, parsed.evidence as InterviewEvidence[], client);
    await setTurnResult(iv.id, {
      coverage: parsed.coverage,
      ...(draft ? { draft } : {}),
      assumptions: parsed.assumptions,
      warnings: parsed.warnings,
    }, client);
    return appendMessage(iv.id, { role: "brian", content: opening }, client);
  }, p);
}

export async function finishTurn(
  iv: Interview, llm: LlmClient = defaultLlm(), p?: TenantTransactionSource,
  sources: InterviewSource[] = [],
): Promise<Interview> {
  const parsed = await completeTurn(llm, buildUser(iv, true, sources));
  return persistReady(iv, parsed, parsed.evidence as InterviewEvidence[], parsed.warnings, p);
}

export async function runTurn(
  iv: Interview, llm: LlmClient = defaultLlm(), p?: TenantTransactionSource,
  sources: InterviewSource[] = [],
  researchClient: ResearchClient = defaultResearchClient(),
): Promise<Interview> {
  const questionsAsked = iv.messages.filter((m) => m.role === "brian").length;
  if (questionsAsked === 0) {
    // Draft first. Two thirds of interviews were abandoned when the opening
    // turn was a blank-page question, so when there is material to read, Brian
    // reads it and drafts the skill BEFORE speaking. The expert then reacts to
    // something concrete and only answers what the sources could not settle.
    if (hasGrounding(iv, sources)) return openFromSources(iv, llm, sources, p);
    const opening = await speak(llm, iv, sources, {}, fallbackOpening(iv, sources));
    return appendMessage(iv.id, { role: "brian", content: opening }, p);
  }
  const forceFinish = questionsAsked >= MAX_QUESTIONS;
  let parsed = await completeTurn(llm, buildUser(iv, forceFinish, sources));
  let researchWarning: string | null = null;
  let research: ResearchResult | undefined;
  if (!forceFinish && parsed.research_query) {
    try {
      research = await researchClient.search(parsed.research_query);
      sources = await addWebResearchSources(iv.id, research);
      parsed = await completeTurn(llm, buildUser(iv, forceFinish, sources, research));
    } catch {
      research = undefined;
      researchWarning = `Web research could not verify: ${parsed.research_query}`;
    }
  }

  const warnings = researchWarning
    ? [...parsed.warnings, researchWarning]
    : parsed.warnings;
  const evidence = parsed.evidence as InterviewEvidence[];
  let draft = parsed.draft as SkillDraft | null;

  // Server-side readiness gate: the parser only proposes completion, it never
  // decides it. Unresolved components turn the turn back into a question.
  let issues: ReadinessIssue[] = [];
  if (parsed.status === "ready" && !forceFinish) {
    const hasCompanySources = sources.some((source) =>
      (source.kind === "connector" || source.kind === "upload") && source.status === "ready",
    ) || Boolean(iv.source_context?.documents.length);
    issues = readinessIssues(parsed, hasCompanySources);
    if (issues.length > 0) parsed = { ...parsed, status: "asking" };
  }

  // forceFinish means the question cap was reached, so the interview completes
  // on this turn either way: it must never strand the expert mid-conversation.
  if (parsed.status === "ready" || forceFinish) {
    return persistReady(iv, parsed, evidence, warnings, p);
  }
  const gaps: ReadinessIssue[] = issues.length > 0 ? issues : COMPONENTS
    .filter((component) => parsed.coverage[component].status === "missing")
    .map((component) => ({ component, detail: `${component} is still missing` }));
  // Deterministic question used only if the conversational model is unavailable,
  // so a live interview never dies on a transient LLM error.
  const fallback = parsed.question?.trim()
    || (gaps.length > 0 ? readinessQuestion(gaps, iv, sources) : null)
    || (researchWarning
      ? "I could not verify that externally. What should Brian treat as authoritative here?"
      : `What else about ${iv.topic} should Brian understand before I write this up?`);
  const question = await speak(llm, iv, sources, {
    research,
    guidance: [
      ...gaps.map((gap) => gap.detail),
      ...(researchWarning ? [`${researchWarning} — do not present it as settled`] : []),
    ],
  }, fallback);
  return withTenantTransaction(async (client) => {
    await replaceInterviewEvidence(iv.id, evidence, client);
    await setTurnResult(iv.id, {
      coverage: parsed.coverage,
      ...(draft ? { draft } : {}),
      assumptions: parsed.assumptions,
      warnings,
    }, client);
    return appendMessage(iv.id, { role: "brian", content: question }, client);
  }, p);
}
