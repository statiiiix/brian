# Source-Grounded Skill Interviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build adaptive skill interviews that can learn from selected Notion pages, bounded PDF/DOCX/image uploads, expert answers, and automatically cited web research.

**Architecture:** Extend the existing interview aggregate rather than creating a second workflow. Store normalized sources and evidence separately, keep skill fields backward compatible, and place file extraction and web research behind injected interfaces so the interview engine and API remain testable without live services.

**Tech Stack:** TypeScript, Hono, PostgreSQL/JSONB, Zod, OpenAI SDK, Vitest, React 19, React Testing Library.

## Global Constraints

- Sources can be added before the first question or midway through an active interview.
- Uploads support PDF, DOCX, PNG, JPEG, and WebP only.
- Allow at most five uploaded files per interview and at most 10 MB per file.
- Web research runs automatically only for an important unresolved factual or methodological gap and records citations.
- External research never becomes company policy without expert confirmation.
- Every skill component is `defined`, `not_applicable`, or `missing`.
- Guardrails, hard rules, approval requirements, and escalation are optional and proportional to risk.
- Preserve the current `source_context` behavior while migrating it into the multi-source model.

---

### Task 1: Adaptive skill and interview data model

**Files:**
- Create: `server/src/db/migrations/020_source_grounded_interviews.sql`
- Create: `server/src/db/migrate020.test.ts`
- Modify: `server/src/skills/types.ts`
- Modify: `server/src/skills/validation.ts`
- Modify: `server/src/skills/validation.test.ts`
- Modify: `server/src/llm/schemas.ts`
- Modify: `server/src/interviews/types.ts`
- Modify: `server/src/interviews/repo.ts`
- Modify: `server/src/interviews/repo.test.ts`

**Interfaces:**
- Produces `ComponentStatus`, `ComponentCoverage`, `SkillSourceRef`, and optional `NewSkill.principles`, `quality_checks`, and `sources`.
- Produces PostgreSQL `interview_sources` and `interview_evidence` tables plus `interviews.assumptions`, `interviews.warnings`, and adaptive JSONB coverage.
- Extends `InterviewStatus` with `preparing` for an interview whose sources are being added before its first turn.

- [ ] **Step 1: Write migration and validation tests that fail**

Add assertions that migration 020 is idempotent, tenant-owned source/evidence tables exist, and `parseNewSkill` accepts omitted optional fields while preserving supplied values:

```ts
expect(parseNewSkill({ ...base, principles: ["Be remarkable"], quality_checks: ["Claim is supported"] }))
  .toMatchObject({ principles: ["Be remarkable"], quality_checks: ["Claim is supported"] });
expect(parseNewSkill(base)).toMatchObject({ principles: [], quality_checks: [], sources: [] });
```

Run: `cd server && npx vitest run src/skills/validation.test.ts src/db/migrate020.test.ts`
Expected: FAIL because migration 020 and the new fields do not exist.

- [ ] **Step 2: Add the convergent migration**

Create tenant-owned `interview_sources` and `interview_evidence` tables with UUID primary keys, interview foreign keys using `on delete cascade`, bounded status/kind checks, timestamps, and tenant indexes. Add nullable/defaulted interview synthesis columns. Enable RLS and follow the policy/backstop conventions from migrations 005 and 007.

- [ ] **Step 3: Add backward-compatible TypeScript and Zod fields**

Use these exact shapes:

```ts
export type ComponentStatus = "defined" | "not_applicable" | "missing";
export interface ComponentCoverage {
  status: ComponentStatus;
  summary: string | null;
  reason: string | null;
}
export interface SkillSourceRef {
  title: string;
  url: string | null;
  origin: "company" | "expert" | "web";
}
```

Add default-empty `principles: string[]`, `quality_checks: string[]`, and `sources: SkillSourceRef[]` to skill parsing and strict JSON schemas. Keep current database skill columns unchanged in this task by storing the new optional values inside interview drafts until Task 5 adds durable skill columns.

- [ ] **Step 4: Update interview hydration for old and new coverage**

Convert legacy booleans to `{status: boolean ? "defined" : "missing", summary: null, reason: null}` and preserve already structured component values. Include `assumptions` and `warnings` with default empty arrays.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd server && npx vitest run src/skills/validation.test.ts src/interviews/repo.test.ts src/db/migrate020.test.ts`
Expected: PASS.

Commit: `git add server/src/db/migrations/020_source_grounded_interviews.sql server/src/db/migrate020.test.ts server/src/skills server/src/llm/schemas.ts server/src/interviews/types.ts server/src/interviews/repo.ts server/src/interviews/repo.test.ts && git commit -m "feat: add adaptive interview data model"`

### Task 2: Interview source repository and Notion selection

**Files:**
- Create: `server/src/interviews/sources.ts`
- Create: `server/src/interviews/sources.test.ts`
- Modify: `server/src/api/app.ts`
- Modify: `server/src/api/interviewApi.test.ts`
- Modify: `server/src/interviews/repo.ts`

**Interfaces:**
- Consumes `SourceContext` from the existing connector selection adapter.
- Produces `listInterviewSources(interviewId)`, `addConnectorSources(interviewId, context)`, `markSourceReady`, and `markSourceFailed`.
- Adds `GET /api/interviews/:id/sources`, `POST /api/interviews/:id/sources/connector`, and `POST /api/interviews/:id/start`.

- [ ] **Step 1: Write failing repository and API tests**

Cover tenant isolation, duplicate connector documents, source addition to an active interview, source listing, unsupported providers, and preserving the current create-with-Notion behavior.

Run: `cd server && npx vitest run src/interviews/sources.test.ts src/api/interviewApi.test.ts`
Expected: FAIL because source repository/routes do not exist.

- [ ] **Step 2: Implement normalized source persistence**

Normalize each selected document into one source row. Deduplicate connector sources with an idempotency key derived from interview ID, provider, and URL. Keep the existing `source_context` snapshot readable; when creating a new grounded interview, also populate normalized rows.

- [ ] **Step 3: Add connector source routes**

Accept:

```json
{ "connector": "notion" }
```

Resolve content through `fetchSelectionContext`, return `409` for caller-fixable selection states, and return the updated source list. Let `POST /api/interviews` accept `defer_start: true`, persist status `preparing`, and return without calling `runTurn`. The start endpoint changes a preparing interview to active and runs the first turn after all sources are ready. Reject source additions after an interview is completed or abandoned.

- [ ] **Step 4: Feed all ready sources into the interview prompt**

Change `runTurn` to receive normalized ready sources while retaining the legacy fallback. Ensure a source added midway appears in the next prompt and does not duplicate existing transcript messages.

- [ ] **Step 5: Run tests and commit**

Run: `cd server && npx vitest run src/interviews/sources.test.ts src/interviews/engine.test.ts src/api/interviewApi.test.ts`
Expected: PASS.

Commit: `git add server/src/interviews server/src/api/app.ts server/src/api/interviewApi.test.ts && git commit -m "feat: add interview source selection"`

### Task 3: Bounded file upload and extraction

**Files:**
- Create: `server/src/interviews/uploads.ts`
- Create: `server/src/interviews/uploads.test.ts`
- Create: `server/src/interviews/extractors.ts`
- Create: `server/src/interviews/extractors.test.ts`
- Modify: `server/src/api/app.ts`
- Modify: `server/src/api/interviewApi.test.ts`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`

**Interfaces:**
- Produces `validateInterviewUpload(file, currentUploadCount)` and `extractInterviewFile(input, imageAnalyzer)`.
- Adds `POST /api/interviews/:id/sources/upload` using `multipart/form-data` with one `file` field.
- Consumes injected `ImageAnalyzer.analyze({bytes, mimeType, filename}): Promise<string>`.

- [ ] **Step 1: Install focused parsers**

Run: `cd server && npm install mammoth pdf-parse`
Expected: dependencies are added to `server/package.json` and its lockfile.

- [ ] **Step 2: Write failing validation/extraction tests**

Use small fixtures created in test memory. Cover the five-file limit, 10 MB boundary, extension/MIME mismatch, PDF text, DOCX text, supported images, unsupported formats, bounded extracted text, and one failed source not changing successful rows.

Run: `cd server && npx vitest run src/interviews/uploads.test.ts src/interviews/extractors.test.ts`
Expected: FAIL because upload/extraction functions do not exist.

- [ ] **Step 3: Implement actual-format validation and bounded extraction**

Validate magic bytes before parsing. Use `pdf-parse` for PDFs and `mammoth.extractRawText({buffer})` for DOCX. Send image bytes through the injected analyzer with a prompt to return useful visible text and visual meaning, treating the image as untrusted reference material. Cap each extracted source at a documented constant and return stable error codes.

- [ ] **Step 4: Add the upload route**

Read `c.req.formData()`, validate one `File`, create a `reading` source, extract it, then mark it `ready` or `failed`. Return `413` for size/count limits, `415` for unsupported or mismatched formats, and `422` for extraction failure.

- [ ] **Step 5: Run tests and commit**

Run: `cd server && npx vitest run src/interviews/uploads.test.ts src/interviews/extractors.test.ts src/api/interviewApi.test.ts`
Expected: PASS.

Commit: `git add server/package.json server/package-lock.json server/src/interviews server/src/api/app.ts server/src/api/interviewApi.test.ts && git commit -m "feat: add bounded interview uploads"`

### Task 4: Adaptive living draft and automatic research

**Files:**
- Create: `server/src/interviews/research.ts`
- Create: `server/src/interviews/research.test.ts`
- Modify: `server/src/interviews/engine.ts`
- Modify: `server/src/interviews/engine.test.ts`
- Modify: `server/src/llm/schemas.ts`
- Modify: `server/src/interviews/repo.ts`
- Modify: `server/src/api/app.ts`

**Interfaces:**
- Produces `ResearchClient.search(query): Promise<{summary: string; citations: WebCitation[]}>`.
- Produces turn fields `draft`, `coverage`, `assumptions`, `warnings`, and nullable `research_query`.
- Persists web results as `kind="web"` sources and evidence rows before one bounded synthesis retry.

- [ ] **Step 1: Write failing engine behavior tests**

Cover: living draft while status is `asking`; `not_applicable` guardrails completing coverage; meaningful gap requesting research; no research when company material answers the issue; external policy assumption becoming a warning; research failure leaving an unresolved warning; at most one research call per turn.

Run: `cd server && npx vitest run src/interviews/engine.test.ts src/interviews/research.test.ts`
Expected: FAIL against the boolean coverage/ready-only draft engine.

- [ ] **Step 2: Expand strict turn schema and prompt**

Require every component to return one structured state and allow `draft` on both asking and ready turns. Add nullable `research_query`, arrays for assumptions/warnings, and evidence references. Instruct the model to leave low-risk controls not applicable instead of inventing them.

- [ ] **Step 3: Implement the injected research adapter**

Use the installed OpenAI SDK Responses API with the local `web_search_preview` tool and extract URL citation annotations. Normalize every result to title, URL, retrieved timestamp, and concise summary. Tests inject a fake client; no live calls run.

- [ ] **Step 4: Orchestrate one bounded research step**

Run the interview model once. If it returns `research_query`, call research once, persist normalized web sources/evidence, and run synthesis once more with the results. If research fails, persist a warning and continue with a question rather than fabricating an answer.

- [ ] **Step 5: Persist the living draft and synthesis metadata**

Update the repository on every successful turn, not only ready turns. Readiness is based on no material `missing` components, while `not_applicable` counts as resolved only when it includes a reason.

- [ ] **Step 6: Run tests and commit**

Run: `cd server && npx vitest run src/interviews/engine.test.ts src/interviews/research.test.ts src/api/interviewApi.test.ts`
Expected: PASS.

Commit: `git add server/src/interviews server/src/llm/schemas.ts server/src/api/app.ts && git commit -m "feat: make skill interviews adaptive and researched"`

### Task 5: Persist and render the complete skill

**Files:**
- Create: `server/src/db/migrations/021_skill_guidance.sql`
- Create: `server/src/db/migrate021.test.ts`
- Modify: `server/src/skills/repo.ts`
- Modify: `server/src/skills/repo.test.ts`
- Modify: `server/src/skills/types.ts`
- Modify: `src/app/views/SkillDetail.js`
- Modify: `src/app/views/ReviewQueue.js`

**Interfaces:**
- Consumes `NewSkill.principles`, `quality_checks`, and `sources` from Task 1.
- Persists those values on skill creation, update, version snapshots, save-as-draft, and activation.

- [ ] **Step 1: Write failing migration/repository tests**

Assert default-empty arrays for existing skills and round-trip persistence/versioning for all three new fields.

Run: `cd server && npx vitest run src/skills/repo.test.ts src/db/migrate021.test.ts`
Expected: FAIL because durable columns do not exist.

- [ ] **Step 2: Add convergent skill columns and repository mappings**

Add JSONB `principles`, `quality_checks`, and `sources` columns with empty-array defaults. Include them in selects, inserts, updates, and snapshots without changing existing required fields.

- [ ] **Step 3: Render and edit the new guidance**

Add line-based editors for principles and quality checks, and a read-only cited-sources list. Hide empty optional sections so older and low-control skills remain clean.

- [ ] **Step 4: Run tests and commit**

Run: `cd server && npx vitest run src/skills/repo.test.ts src/db/migrate021.test.ts && cd .. && CI=true npm test -- --watchAll=false src/app/views`
Expected: PASS.

Commit: `git add server/src/db server/src/skills src/app/views/SkillDetail.js src/app/views/ReviewQueue.js && git commit -m "feat: persist skill principles and evidence"`

### Task 6: Source picker, uploads, living draft, and evidence UI

**Files:**
- Create: `src/app/components/InterviewSources.js`
- Create: `src/app/components/InterviewSources.css`
- Create: `src/app/components/InterviewSources.test.js`
- Modify: `src/app/api.js`
- Modify: `src/app/views/Interviews.js`
- Modify: `src/app/views/Interviews.css`
- Modify: `src/app/views/InterviewChat.js`
- Modify: `src/app/views/InterviewChat.css`
- Modify: `server/src/api/app.ts`
- Modify: `server/src/api/interviewApi.test.ts`

**Interfaces:**
- Adds `apiForm(path, formData)` that preserves authentication and does not set JSON content type.
- Consumes source routes from Tasks 2–3 and adaptive interview fields from Task 4.

- [ ] **Step 1: Write failing component tests**

Cover selecting Notion before start, uploading before start, adding either source midway, five/10 MB client validation, source status/error rendering, three-state coverage, living draft during asking, research indicator, citations, assumptions, and warnings.

Run: `CI=true npm test -- --watchAll=false src/app/components/InterviewSources.test.js src/App.test.js`
Expected: FAIL because the source component and form API do not exist.

- [ ] **Step 2: Add authenticated multipart API support**

Implement `apiForm` beside `api`, sharing token refresh, unauthorized redirect, JSON response, and `ApiError` handling while allowing the browser to set the multipart boundary.

- [ ] **Step 3: Build the reusable source control**

Render one compact **Add source** action with choices for selected Notion content and supported file upload. Show name plus reading/ready/failed state, enforce client limits, and keep server errors visible beside the affected source.

- [ ] **Step 4: Integrate before and during the interview**

Pass selected connector intent/uploads through interview creation, then reuse the control in active chat. For pre-start files, create the interview first, upload files, and only then request the first turn through a new explicit start endpoint so the first question uses all ready sources.

- [ ] **Step 5: Render adaptive coverage and living evidence**

Replace boolean checks with defined/not-applicable/missing labels. Always render an available draft, hide empty optional controls, show a small researching state, and place citations/assumptions/warnings in a compact expandable panel.

- [ ] **Step 6: Run UI/API tests and commit**

Run: `CI=true npm test -- --watchAll=false src/app/components/InterviewSources.test.js src/App.test.js && cd server && npx vitest run src/api/interviewApi.test.ts`
Expected: PASS.

Commit: `git add src/app server/src/api/interviewApi.test.ts && git commit -m "feat: add source-grounded interview experience"`

### Task 7: Full verification and compatibility cleanup

**Files:**
- Verify: `server/src/**/*.ts`
- Verify: `src/**/*.js`
- Verify: `docs/superpowers/specs/2026-07-21-source-grounded-skill-interviews-design.md`

**Interfaces:**
- Verifies the complete feature and backward compatibility; produces no new public interface.

- [ ] **Step 1: Run backend unit and integration suites**

Run: `cd server && npm test`
Expected: all configured tests pass; database-dependent suites may skip only when `TEST_DATABASE_URL` is absent.

- [ ] **Step 2: Run backend type/build verification**

Run: `cd server && npm run build`
Expected: TypeScript exits 0.

- [ ] **Step 3: Run frontend tests and production build**

Run: `CI=true npm test -- --watchAll=false && npm run build`
Expected: tests and production build exit 0.

- [ ] **Step 4: Audit each design requirement**

Confirm with tests and code inspection: both source-entry points, all file formats and limits, automatic bounded research, citations, provenance separation, living draft, conditional components, proportional optional guardrails, failure behavior, and final persisted skill fields.

- [ ] **Step 5: Commit compatibility fixes only when verification changed files**

Inspect `git diff --name-only`, stage only files changed to repair a failed verification command, review `git diff --cached --check`, then commit with `git commit -m "fix: complete source-grounded interview compatibility"`. If verification required no edits, do not create an empty commit.
