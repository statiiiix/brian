import type { InterviewSource, SourceContext } from "./types.js";

export interface SourceGuidanceRule {
  name: string;
  represents: string;
  interpretation: readonly string[];
  cautions: readonly string[];
}

// Keep this keyed by the connector IDs stored on interview_sources. These
// rules describe how to reason about provider data; they never promote the
// provider's content to approved company policy.
export const DASHBOARD_SOURCE_GUIDANCE: Readonly<Record<string, SourceGuidanceRule>> = {
  notion: {
    name: "Notion",
    represents: "workspace pages, databases, SOPs, and team-authored reference material",
    interpretation: [
      "Preserve page hierarchy, database field meaning, and links between related pages.",
      "Use titles, owners, and last-edited context to distinguish operating guidance from background notes.",
    ],
    cautions: [
      "A published page may be stale, incomplete, or descriptive rather than mandatory.",
    ],
  },
  confluence: {
    name: "Confluence",
    represents: "team spaces, runbooks, policies, decision records, and linked operational pages",
    interpretation: [
      "Preserve space, page hierarchy, labels, and links to understand scope and ownership.",
      "Distinguish durable runbooks and decisions from drafts, comments, and historical versions.",
    ],
    cautions: [
      "A page's existence does not prove it is current or authoritative for every team.",
    ],
  },
  sharepoint: {
    name: "SharePoint",
    represents: "controlled sites, document libraries, policies, and organization-owned files",
    interpretation: [
      "Use site, library, folder, document metadata, and version context to determine scope.",
      "Prefer clearly owned and controlled documents over convenient copies.",
    ],
    cautions: [
      "Duplicates and inherited permissions can obscure which document is authoritative.",
    ],
  },
  onedrive: {
    name: "OneDrive",
    represents: "working documents and files owned or shared by individuals",
    interpretation: [
      "Use file ownership, path, sharing context, and modification time when judging relevance.",
      "Treat working documents as evidence of practice that may need expert confirmation.",
    ],
    cautions: [
      "A personal working file is not automatically an organization-approved process.",
    ],
  },
  google_drive: {
    name: "Google Drive",
    represents: "Docs, Sheets, Slides, folders, and shared operational files",
    interpretation: [
      "Preserve folder context, document structure, ownership, and modification chronology.",
      "Separate templates, working drafts, and finalized playbooks before extracting rules.",
    ],
    cautions: [
      "Shared access and a recent edit do not by themselves establish policy authority.",
    ],
  },
  gmail: {
    name: "Gmail",
    represents: "email threads containing requests, approvals, exceptions, and handoffs",
    interpretation: [
      "Preserve participants, timestamps, reply order, quoted text, and the final decision.",
      "Distinguish a reusable decision rule from a one-off exception or negotiation.",
    ],
    cautions: [
      "Do not flatten forwarded or quoted messages into the sender's current position.",
    ],
  },
  outlook: {
    name: "Outlook",
    represents: "mailbox threads, approvals, exceptions, and organization communications",
    interpretation: [
      "Preserve sender, recipients, timestamps, folders, reply order, and the final decision.",
      "Identify whether an approval applies broadly or only to the case in that thread.",
    ],
    cautions: [
      "Quoted, forwarded, draft, and automated mail may not express the author's current decision.",
    ],
  },
  slack: {
    name: "Slack",
    represents: "channel and thread conversations containing conversational decisions and rationale",
    interpretation: [
      "Preserve channel, thread, participants, chronology, alternatives considered, and reactions.",
      "Look for the final accountable decision and distinguish it from brainstorming or social agreement.",
    ],
    cautions: [
      "Conversation, emoji reactions, and repeated practice are not automatically approved policy.",
    ],
  },
  microsoft_teams: {
    name: "Microsoft Teams",
    represents: "team, channel, and thread conversations containing decisions and collaboration history",
    interpretation: [
      "Preserve team and channel scope, reply nesting, participants, chronology, and shared-file context.",
      "Separate the final accountable decision from proposals, meeting chatter, and partial agreement.",
    ],
    cautions: [
      "A channel discussion is not automatically an approved organization-wide rule.",
    ],
  },
  jira: {
    name: "Jira",
    represents: "issues, workflow state, comments, incidents, linked work, and resolution history",
    interpretation: [
      "Read description, fields, status transitions, comments, links, assignee, and resolution together.",
      "Extract repeatable handling from the decision trail, not from status alone.",
    ],
    cautions: [
      "Closed or resolved status does not prove the resolution was correct, approved, or reusable.",
    ],
  },
  linear: {
    name: "Linear",
    represents: "issues, projects, workflow state, comments, and product or engineering decisions",
    interpretation: [
      "Use issue description, labels, project context, status history, comments, and assignee together.",
      "Distinguish a repeatable decision pattern from implementation detail for one issue.",
    ],
    cautions: [
      "Completed or canceled state alone does not establish the correct operating rule.",
    ],
  },
  github: {
    name: "GitHub",
    represents: "repositories, documentation, issues, pull requests, reviews, and code-linked decisions",
    interpretation: [
      "Preserve repository and path context, version, issue or pull-request chronology, and review outcome.",
      "Separate executable behavior and accepted review decisions from proposals and superseded code.",
    ],
    cautions: [
      "A merged change or README statement may be historical and not an organization-wide policy.",
    ],
  },
  asana: {
    name: "Asana",
    represents: "tasks, projects, assignments, dependencies, comments, and operational checklists",
    interpretation: [
      "Use project, section, custom fields, dependencies, assignee, comments, and completion history together.",
      "Infer repeatable workflow from recurring decisions, not merely the task template.",
    ],
    cautions: [
      "Task completion does not prove every listed step was performed or remains required.",
    ],
  },
  clickup: {
    name: "ClickUp",
    represents: "tasks, lists, spaces, custom fields, checklists, and operational workflows",
    interpretation: [
      "Preserve workspace hierarchy, custom-field meaning, dependencies, assignee, comments, and status history.",
      "Distinguish configured workflow from what operators actually decided in completed work.",
    ],
    cautions: [
      "A status or checklist mark alone does not prove the underlying decision was correct.",
    ],
  },
  zendesk: {
    name: "Zendesk",
    represents: "customer tickets, comments, tags, assignments, escalations, and resolution outcomes",
    interpretation: [
      "Preserve requester context, public versus internal comments, tags, ownership, chronology, and outcome.",
      "Compare similar resolved cases to separate repeatable handling from one-off accommodation.",
    ],
    cautions: [
      "A solved ticket documents what happened, not necessarily approved policy or a successful outcome.",
    ],
  },
  intercom: {
    name: "Intercom",
    represents: "customer conversations, inbox assignments, tags, replies, and resolution history",
    interpretation: [
      "Preserve participant roles, public and internal messages, assignment changes, chronology, and outcome.",
      "Distinguish standard service judgment from customer-specific promises and exceptions.",
    ],
    cautions: [
      "A closed conversation does not prove the response was correct or broadly reusable.",
    ],
  },
  hubspot: {
    name: "HubSpot",
    represents: "structured CRM records, pipelines, activities, ownership, and handoff history",
    interpretation: [
      "Interpret structured records using object type, field semantics, pipeline, stage changes, owner, and activity chronology.",
      "Separate configured lifecycle definitions from the judgment shown in notes and transitions.",
    ],
    cautions: [
      "A populated field or pipeline stage may be automated, stale, or inconsistently used.",
    ],
  },
  salesforce: {
    name: "Salesforce",
    represents: "structured records, cases, opportunities, approvals, field history, and ownership",
    interpretation: [
      "Interpret structured records using object type, field semantics, stage or status history, owner, and related activity.",
      "Use approval and field history to reconstruct who decided what and under which record conditions.",
    ],
    cautions: [
      "A record state or required field does not alone establish the rationale or correctness of a decision.",
    ],
  },
  gong: {
    name: "Gong",
    represents: "recorded calls, transcripts, objections, commitments, and coaching conversations",
    interpretation: [
      "Preserve speaker identity, sequence, surrounding discussion, explicit commitments, and call outcome.",
      "Distinguish customer statements, seller interpretation, coaching advice, and final company decisions.",
    ],
    cautions: [
      "Transcripts may be imperfect, and tentative spoken statements require confirmation.",
    ],
  },
  zoom: {
    name: "Zoom",
    represents: "meeting recordings, transcripts, walkthroughs, decisions, and participant discussion",
    interpretation: [
      "Preserve speaker identity, meeting purpose, chronology, demonstrations, decisions, and assigned follow-ups.",
      "Separate exploratory discussion from an explicit decision or demonstrated operating step.",
    ],
    cautions: [
      "Transcripts may be imperfect, and a spoken suggestion is not automatically approved policy.",
    ],
  },
};

const UPLOAD_TYPES = new Set(["pdf", "docx", "png", "jpeg", "jpg", "webp"]);

const UPLOAD_GUIDANCE: SourceGuidanceRule = {
  name: "Uploaded File",
  represents: "a file the expert deliberately attached to this interview",
  interpretation: [
    "Use headings, tables, visual structure, and document order when reconstructing the process.",
    "Tie extracted rules to the file title and ask about missing ownership, scope, or freshness.",
  ],
  cautions: [
    "Extraction or OCR may lose formatting or text, and an uploaded file is not automatically current policy.",
  ],
};

const UNKNOWN_GUIDANCE: SourceGuidanceRule = {
  name: "",
  represents: "an Unknown or newly added company source",
  interpretation: [
    "Use the material as evidence, preserve its internal structure and chronology, and identify gaps explicitly.",
  ],
  cautions: [
    "Do not treat this material as approved company policy without expert confirmation.",
  ],
};

function titleCase(sourceType: string): string {
  return sourceType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function sourceDisplayName(sourceType: string): string {
  if (UPLOAD_TYPES.has(sourceType)) return UPLOAD_GUIDANCE.name;
  return DASHBOARD_SOURCE_GUIDANCE[sourceType]?.name ?? titleCase(sourceType);
}

function ruleFor(sourceType: string): SourceGuidanceRule {
  if (UPLOAD_TYPES.has(sourceType)) return UPLOAD_GUIDANCE;
  return DASHBOARD_SOURCE_GUIDANCE[sourceType] ?? {
    ...UNKNOWN_GUIDANCE,
    name: sourceDisplayName(sourceType),
  };
}

function formatRule(sourceType: string): string {
  const rule = ruleFor(sourceType);
  return [
    `### Provider: ${rule.name}`,
    `This source represents ${rule.represents}.`,
    "Interpretation rules:",
    ...rule.interpretation.map((item) => `- ${item}`),
    "Cautions:",
    ...rule.cautions.map((item) => `- ${item}`),
  ].join("\n");
}

export function sourceGuidance(sources: InterviewSource[]): string {
  const sourceTypes = [...new Set(
    sources
      .filter((source) =>
        source.kind !== "web"
        && source.status === "ready"
        && Boolean(source.extracted_text?.trim()))
      .map((source) => source.source_type),
  )];
  if (sourceTypes.length === 0) return "";

  return [
    "Provider-specific source rules for this interview:",
    ...sourceTypes.map(formatRule),
    "When providers disagree, preserve the disagreement and ask the expert which source governs. "
      + "Never silently merge their authority.",
  ].join("\n\n");
}

function materialSources(sources: InterviewSource[]): InterviewSource[] {
  return sources.filter((source) =>
    source.kind !== "web"
    && source.status === "ready"
    && Boolean(source.extracted_text?.trim()));
}

function materialDocument(source: InterviewSource): string {
  return [
    `### ${source.title}`,
    `Provider: ${sourceDisplayName(source.source_type)}`,
    `Source: ${source.url ?? "No source URL"}`,
    source.extracted_text,
  ].join("\n");
}

function legacySources(context: SourceContext): InterviewSource[] {
  return context.documents
    .filter((document) => Boolean(document.text.trim()))
    .map((document, index) => ({
      id: `legacy-source-${index}`,
      interview_id: "legacy-interview",
      kind: "connector" as const,
      title: document.title,
      source_type: context.source_type,
      url: document.url || null,
      status: "ready" as const,
      extracted_text: document.text,
      idempotency_key: `legacy-source-${index}`,
      added_at: context.fetched_at,
      retrieved_at: context.fetched_at,
      error_code: null,
    }));
}

export function sourceMaterialPrompt(
  context: SourceContext | null,
  sources: InterviewSource[] = [],
): string {
  const ready = materialSources(sources);
  if (ready.length > 0) {
    return [
      "Source material selected for this interview:",
      ready.map(materialDocument).join("\n\n"),
      sourceGuidance(ready),
      `Ground the skill in this material. On the first turn, briefly explain what you learned
from the selected source, then ask how its most important principle should apply to this
specific company or use case. Never re-ask what the source already answers; ask about gaps,
ambiguities, thresholds, application decisions, and edge cases. Cite source titles where relevant.`,
    ].join("\n\n");
  }

  if (!context || context.documents.length === 0) return "";
  const legacy = legacySources(context);
  if (legacy.length === 0) return "";
  return [
    `Source material from the company's connected ${sourceDisplayName(context.source_type)} workspace (fetched ${context.fetched_at}):`,
    legacy.map(materialDocument).join("\n\n"),
    sourceGuidance(legacy),
    `Ground the skill in this material: extract the trigger, inputs, step-by-step procedure,
hard rules, guardrails, escalation target, and concrete worked use-case examples directly
from it wherever the material states them. On your FIRST question, briefly summarize what
you already inferred from the material, then ask about the most important gap. Never
re-ask what the material already answers — ask only about gaps, ambiguities, thresholds,
and edge cases the material leaves open. Make examples ultra-detailed worked use cases
(situation → correct handling), citing the source document titles where relevant.`,
  ].join("\n\n");
}
