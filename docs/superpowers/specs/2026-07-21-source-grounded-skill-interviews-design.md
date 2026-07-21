# Source-Grounded Skill Interviews — Design

Date: 2026-07-21
Status: approved in founder interview

## Goal

Turn the existing interview flow into a conversation-native research workspace. A user can ground an interview in connected company content or uploaded files, discuss the material with Brian, let Brian research important gaps, and finish with an executable skill whose sources, assumptions, and unresolved questions are visible.

The implementation should extend the current interview and `source_context` work. It should not introduce a separate autonomous-agent system or a broad architectural rewrite.

## Product Decisions

1. Sources may be added when an interview is created or at any later point in the conversation.
2. The initial connected-source experience includes selecting Notion pages. The model supports other connected sources through the same interface later.
3. Direct uploads support PDF, DOCX, PNG, JPEG, and WebP.
4. An interview accepts at most five uploaded files, each no larger than 10 MB.
5. Brian searches the public web automatically when the selected sources and expert answers leave an important factual or methodological gap.
6. Brian asks one focused question per turn and prioritizes the most important unresolved issue.
7. The draft evolves during the conversation instead of appearing only when the interview finishes.
8. Skill components are adaptive. A component can be `defined`, `not_applicable`, or `missing`.
9. Guardrails, hard rules, approval requirements, and escalation paths are optional and proportional to the skill's actual risk. Brian must not invent bureaucracy to fill fields.
10. A skill is ready when an agent can use it reliably, material uncertainties are visible, and every relevant component is resolved.

## User Experience

### Starting an interview

The new-interview form keeps the topic and optional owner fields and adds an **Add source** action. The source picker offers:

- Connected content, initially selected Notion pages.
- Local file upload for the supported formats.

The user may start immediately. Sources display a small processing state: `reading`, `ready`, or `failed`.

### During the conversation

The active chat also exposes **Add source**. Adding material midway does not restart the interview. Brian analyzes the new source, reports a concise summary of what it learned, updates the evolving draft and coverage, and changes subsequent questions to address the new highest-priority gap.

Brian distinguishes information by origin:

- Company source material.
- Expert decisions stated in the interview.
- External web research.

The interface exposes source names and citations without crowding the conversation. A compact source/evidence panel may show the details on demand.

### Completion and review

Before saving or activating, the review shows:

- The complete skill draft.
- Sources and citations supporting it.
- Assumptions made during synthesis.
- Material unresolved warnings.
- Components marked not applicable and their reasons.

The existing save-as-draft and approve/activate actions remain available.

## Skill Model

The interview evaluates the following possible components:

- Purpose and trigger.
- Required inputs.
- Principles or methodology learned from the selected sources.
- Step-by-step procedure and decision logic.
- Tools the agent may use.
- Hard rules, when applicable.
- Guardrails or prohibited actions, when applicable and proportional to risk.
- Escalation conditions and target, only when genuinely needed.
- Quality checks defining a successful result.
- Detailed examples and edge cases.
- Sources and citations.

Each component has a coverage state:

```ts
type ComponentState =
  | { status: "defined"; summary: string }
  | { status: "not_applicable"; reason: string }
  | { status: "missing"; question: string };
```

Principles are retained as explicit decision guidance in the skill. They are distinct from hard rules: principles guide judgment, while hard rules are absolute constraints. A source-specific methodology such as Purple Cow marketing can therefore remain recognizable and usable without being flattened into generic procedure text.

Existing skill fields should remain backward compatible. New optional fields may be added for `principles`, `quality_checks`, `sources`, and synthesis metadata. Empty optional controls must not be generated merely to satisfy schema shape.

## Source and Evidence Model

Replace the single embedded source snapshot with a collection of interview sources. Each source stores bounded extracted content and provenance sufficient for review and reproducibility:

```ts
interface InterviewSource {
  id: string;
  kind: "connector" | "upload" | "web";
  title: string;
  sourceType: string;
  url: string | null;
  status: "reading" | "ready" | "failed";
  extractedText: string | null;
  addedAt: string;
  retrievedAt: string | null;
  errorCode: string | null;
}
```

An evidence entry links a draft statement or component to one or more sources and records whether it came from company material, the expert, or external research. The model should store concise evidence references rather than duplicating whole documents in every draft field.

Uploaded files are validated before extraction. Extraction is bounded so prompts and storage cannot grow without limit. Failed files identify the affected source and do not prevent the user from continuing with other material.

## Interview and Research Behavior

On every turn, the engine considers the transcript, ready sources, current draft, coverage states, and evidence. Its structured result includes:

- The next question, if one is needed.
- The updated living draft.
- Updated component states.
- New evidence references and citations.
- Assumptions and material warnings.
- A research request when an important external knowledge gap exists.

Web research is automatic, but bounded and purposeful. Brian must:

1. Search only when existing sources and expert answers do not adequately resolve an important factual or methodological gap.
2. Prefer authoritative sources relevant to the methodology or claim.
3. Record the page URL, title, and retrieval date.
4. Clearly distinguish public information from company policy.
5. Ask the expert to confirm any company-specific decision that cannot be established from company sources.
6. Never treat external advice as an internal mandate without confirmation.

The engine may perform a bounded research step and then synthesize the turn. It must not enter an uncontrolled browsing loop.

## Backend Components

Keep the implementation in small units with clear responsibilities:

- Interview source repository: creates sources and tracks processing state.
- Source selection adapter: reuses the existing connected-source selection path, initially for Notion.
- Upload validation and extraction service: validates limits and routes PDF, DOCX, and image inputs to format-specific extractors.
- Web research adapter: performs bounded searches and returns normalized citations.
- Interview engine: decides the next question, updates the living draft, and requests research when justified.
- Evidence ledger: normalizes provenance used by the draft and final review.

The existing interview REST API remains the base. Add focused endpoints for listing/adding interview sources and uploading files. Existing message, resume, abandon, save, and activate behavior should remain compatible.

## Frontend Components

- Reusable **Add source** control for the new-interview form and active chat.
- Source picker with connected-content and upload choices.
- Source status list showing reading, ready, and failed states.
- Living draft panel with component coverage.
- Compact evidence, citations, assumptions, and warnings panel.
- A brief researching state when Brian performs automatic web research.

The source UI should stay subordinate to the conversation. It should help the user understand what Brian learned without turning the interview into a document-management screen.

## Error Handling and Safety

- Reject unsupported formats, files above 10 MB, and uploads beyond the five-file limit with specific user-facing errors.
- Treat a file's declared type as untrusted; validate its actual format before parsing.
- Bound extracted content per source and for the interview as a whole.
- Treat uploaded, connected, and web content as untrusted reference material, not instructions that can override Brian's interview or security rules.
- Preserve successful sources when one source fails.
- Make source addition idempotent enough to prevent duplicate records after a client retry.
- If web research fails, continue the interview and mark the knowledge gap unresolved rather than inventing an answer.
- Require confirmation for material company-specific assumptions learned only from external sources.

## Testing

Backend tests should cover:

- File count, size, and actual-format validation.
- Successful and failed PDF, DOCX, and image extraction.
- Connector source selection and adding sources midway.
- Source processing state transitions and retry behavior.
- Conditional components, especially legitimate `not_applicable` results.
- Guardrails and escalation remaining absent for low-risk skills when unnecessary.
- Automatic research triggering only for meaningful gaps.
- Citation normalization and provenance separation.
- Research failure leaving an explicit unresolved warning.
- Living draft updates and readiness based on relevant coverage rather than populated generic fields.

Frontend tests should cover:

- Adding sources before and during an interview.
- Upload validation messages and source states.
- Living draft and adaptive coverage rendering.
- Research, citation, assumption, and warning displays.
- Existing interview completion actions remaining functional.

## Scope Boundaries

This design does not include unrestricted autonomous browsing, arbitrary file types, a general document library, continuous background crawling, or mandatory heavy controls for every skill. It delivers one focused capability: evidence-grounded, adaptive interviews that produce practical agent skills.
