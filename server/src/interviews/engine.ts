import { z } from "zod";
import { withTenantTransaction, type TenantTransactionSource } from "../db/tenant.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { INTERVIEW_TURN_JSON_SCHEMA } from "../llm/schemas.js";
import { parseNewSkill } from "../skills/validation.js";
import { appendMessage, setTurnResult } from "./repo.js";
import { defaultResearchClient, type ResearchClient, type ResearchResult } from "./research.js";
import { addWebResearchSources, replaceInterviewEvidence } from "./sources.js";
import { normalizeCoverage } from "./types.js";
import type { Interview, InterviewEvidence, InterviewSource, SkillDraft } from "./types.js";

export const MAX_QUESTIONS = 25;

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

On the opening turn, welcome the expert and invite them to explain in their own words what
skill they want to build, who or what it is for, and any context they think matters. Treat the
topic as a hint, not a complete definition.

On later turns, first respond to what the expert actually said. Briefly reflect useful
understanding, answer their question, or repair a misunderstanding. Then ask one thoughtful
follow-up that naturally deepens the skill. You may use a few conversational sentences before
the question. Do not fire disconnected checklist questions.

Move naturally from intent and desired outcome, to source principles and how they apply, to
real workflow and judgment, then quality and examples. Only discuss rules, approvals,
guardrails, or escalation near the end and only if meaningful risk makes them relevant. If the
expert says those controls are unnecessary, accept it and move on without rephrasing the same
question. Use the hidden draft and gaps as guidance, not as a script. Return only the message
the expert should see.`;

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
  const ready = sources.filter((source) => source.status === "ready" && source.extracted_text);
  if (ready.length > 0) {
    const docs = ready.map((source) =>
      `### ${source.title}\nSource: ${source.url ?? source.source_type}\n${source.extracted_text}`,
    ).join("\n\n");
    return [
      "Source material selected for this interview:",
      docs,
      `Ground the skill in this material. On the first turn, briefly explain what you learned
from the selected source, then ask how its most important principle should apply to this
specific company or use case. Never re-ask what the source already answers; ask about gaps,
ambiguities, thresholds, application decisions, and edge cases. Cite source titles where relevant.`,
    ].join("\n\n");
  }
  const ctx = iv.source_context;
  if (!ctx || ctx.documents.length === 0) return "";
  const docs = ctx.documents
    .map((d) => `### ${d.title}\nSource: ${d.url}\n${d.text}`)
    .join("\n\n");
  return [
    `Source material from the company's connected ${ctx.source_type} workspace (fetched ${ctx.fetched_at}):`,
    docs,
    `Ground the skill in this material: extract the trigger, inputs, step-by-step procedure,
hard rules, guardrails, escalation target, and concrete worked use-case examples directly
from it wherever the material states them. On your FIRST question, briefly summarize what
you already inferred from the material, then ask about the most important gap. Never
re-ask what the material already answers — ask only about gaps, ambiguities, thresholds,
and edge cases the material leaves open. Make examples ultra-detailed worked use cases
(situation → correct handling), citing the source document titles where relevant.`,
  ].join("\n\n");
}

function buildUser(
  iv: Interview, forceFinish: boolean, sources: InterviewSource[] = [],
  research?: ResearchResult,
): string {
  const transcript = iv.messages
    .map((m) => `${m.role === "brian" ? "Brian" : "Expert"}: ${m.content}`)
    .join("\n");
  return [
    `Process being captured: ${iv.topic}`,
    iv.owner ? `Process owner: ${iv.owner}` : "",
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

function buildInterviewerUser(
  iv: Interview, sources: InterviewSource[],
  opts: { research?: ResearchResult; guidance?: string[]; forceFinish?: boolean } = {},
): string {
  const transcript = iv.messages
    .map((m) => `${m.role === "brian" ? "Brian" : "Expert"}: ${m.content}`)
    .join("\n");
  return [
    `Skill being built: ${iv.topic}`,
    iv.owner ? `Process owner: ${iv.owner}` : "",
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

export async function runTurn(
  iv: Interview, llm: LlmClient = defaultLlm(), p?: TenantTransactionSource,
  sources: InterviewSource[] = [],
  researchClient: ResearchClient = defaultResearchClient(),
): Promise<Interview> {
  const questionsAsked = iv.messages.filter((m) => m.role === "brian").length;
  if (questionsAsked === 0) {
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

  if (parsed.status === "ready") {
    const raw = (draft ?? {}) as Record<string, unknown>;
    const completeDraft = parseNewSkill({ ...raw, owner: raw.owner ?? iv.owner ?? null });
    draft = {
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
    return withTenantTransaction(
      async (client) => {
        await replaceInterviewEvidence(iv.id, evidence, client);
        return setTurnResult(iv.id, {
          coverage: parsed.coverage, draft: draft!, ready: true,
          assumptions: parsed.assumptions, warnings,
        }, client);
      },
      p,
    );
  }
  if (forceFinish) throw new Error("interview exceeded max questions");
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
