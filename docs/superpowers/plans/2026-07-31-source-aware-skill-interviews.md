# Source-aware Skill Interviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach both skill-interview models how to interpret every dashboard source provider while sending only the rules for ready sources attached to the current interview.

**Architecture:** Add a focused provider-guidance registry beside the interview engine. The engine formats ready source material with explicit provider labels and injects deduplicated provider-specific guidance into both parser and interviewer prompts. Existing API paths already pass current interview sources into every turn, so initial and mid-interview attachments share this behavior.

**Tech Stack:** TypeScript, Zod, Vitest, Hono, esbuild, Supabase Edge Functions

## Global Constraints

- Cover Notion, Confluence, SharePoint, OneDrive, Google Drive, Gmail, Outlook, Slack, Microsoft Teams, Jira, Linear, GitHub, Asana, ClickUp, Zendesk, Intercom, HubSpot, Salesforce, Gong, and Zoom.
- Inject only guidance for ready attached sources with non-empty extracted material.
- Keep providers separately labeled and deduplicate repeated provider rule blocks.
- Preserve existing Notion behavior.
- Use conservative generic guidance for unknown future providers.
- Uploaded files receive generic file guidance; web research remains external rather than company policy.
- Do not change OAuth, source selection, or connector synchronization.
- Regenerate the Supabase edge bundle from server source; do not hand-edit generated code.

## File Structure

- Create `server/src/interviews/sourceGuidance.ts`: provider registry, generic fallbacks, and prompt-block builder.
- Create `server/src/interviews/sourceGuidance.test.ts`: catalog coverage, filtering, deduplication, and fallback tests.
- Modify `server/src/interviews/engine.ts`: label source material by provider and inject attached-source guidance into both model prompts.
- Modify `server/src/interviews/engine.test.ts`: integration coverage for parser/interviewer prompts and sources added between turns.
- Regenerate `supabase/functions/brian/index.js` and `supabase/functions/brian/index.ts`: deploy artifacts produced by `server/scripts/edge-build.mjs`.

---

### Task 1: Provider guidance registry

**Files:**
- Create: `server/src/interviews/sourceGuidance.ts`
- Create: `server/src/interviews/sourceGuidance.test.ts`

**Interfaces:**
- Consumes: `InterviewSource` from `server/src/interviews/types.ts`
- Produces: `sourceDisplayName(sourceType: string): string`
- Produces: `sourceGuidance(sources: InterviewSource[]): string`
- Produces: `DASHBOARD_SOURCE_GUIDANCE: Readonly<Record<string, SourceGuidanceRule>>`

- [ ] **Step 1: Write the failing catalog and prompt-builder tests**

Create tests which:

```ts
const DASHBOARD_SOURCE_TYPES = [
  "notion", "confluence", "sharepoint", "onedrive", "google_drive",
  "gmail", "outlook", "slack", "microsoft_teams", "jira", "linear",
  "github", "asana", "clickup", "zendesk", "intercom", "hubspot",
  "salesforce", "gong", "zoom",
];

it("defines explicit interview guidance for every dashboard source", () => {
  expect(Object.keys(DASHBOARD_SOURCE_GUIDANCE).sort())
    .toEqual([...DASHBOARD_SOURCE_TYPES].sort());
});

it("includes only ready non-empty attached providers and deduplicates them", () => {
  const prompt = sourceGuidance([
    source({ source_type: "slack", title: "A", status: "ready", extracted_text: "one" }),
    source({ source_type: "slack", title: "B", status: "ready", extracted_text: "two" }),
    source({ source_type: "jira", status: "failed", extracted_text: "ignored" }),
    source({ source_type: "linear", status: "ready", extracted_text: "" }),
  ]);
  expect(prompt.match(/Provider: Slack/g)).toHaveLength(1);
  expect(prompt).not.toContain("Provider: Jira");
  expect(prompt).not.toContain("Provider: Linear");
});

it("uses conservative guidance for an unknown provider", () => {
  const prompt = sourceGuidance([
    source({ source_type: "future_source", status: "ready", extracted_text: "content" }),
  ]);
  expect(prompt).toContain("Provider: Future Source");
  expect(prompt).toContain("Do not treat this material as approved company policy");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd server
npx vitest run src/interviews/sourceGuidance.test.ts
```

Expected: FAIL because `sourceGuidance.ts` does not exist.

- [ ] **Step 3: Implement the typed registry and prompt builder**

Implement:

```ts
export interface SourceGuidanceRule {
  name: string;
  represents: string;
  interpretation: string[];
  cautions: string[];
}

export const DASHBOARD_SOURCE_GUIDANCE = {
  notion: { name: "Notion", represents: "...", interpretation: ["..."], cautions: ["..."] },
  // One explicit entry for every provider in Global Constraints.
} as const satisfies Readonly<Record<string, SourceGuidanceRule>>;

export function sourceDisplayName(sourceType: string): string {
  return DASHBOARD_SOURCE_GUIDANCE[sourceType]?.name
    ?? sourceType.split("_").map(capitalize).join(" ");
}

export function sourceGuidance(sources: InterviewSource[]): string {
  const sourceTypes = [...new Set(sources
    .filter((source) => source.status === "ready" && source.extracted_text?.trim())
    .map((source) => source.source_type))];
  if (sourceTypes.length === 0) return "";
  return [
    "Provider-specific source rules for this interview:",
    ...sourceTypes.map(formatRule),
    "When providers disagree, preserve the disagreement and ask the expert which source governs.",
  ].join("\n\n");
}
```

Include explicit, concise rules for all 20 providers. Unknown providers use
generic company-source guidance. Uploads use a generic uploaded-file rule when
their source type is `pdf`, `docx`, `png`, `jpeg`, or `webp`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
cd server
npx vitest run src/interviews/sourceGuidance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add server/src/interviews/sourceGuidance.ts server/src/interviews/sourceGuidance.test.ts
git commit -m "feat: define interview guidance for every source"
```

### Task 2: Inject provider identity and rules into both interview models

**Files:**
- Modify: `server/src/interviews/engine.ts`
- Modify: `server/src/interviews/engine.test.ts`

**Interfaces:**
- Consumes: `sourceDisplayName(sourceType)` and `sourceGuidance(sources)` from Task 1
- Produces: parser and interviewer prompts containing attached-provider identity and guidance

- [ ] **Step 1: Write failing integration tests**

Add tests proving:

```ts
it("passes attached provider names and rules to both interview agents", async () => {
  const sources = [
    readySource({ source_type: "slack", title: "Refund decisions", extracted_text: "..." }),
    readySource({ source_type: "salesforce", title: "Escalated cases", extracted_text: "..." }),
  ];
  const llm = fake([turn({ draft: goodDraft })], "What should govern when they differ?");
  await runTurn(await createInterview({ topic: "Refund handling" }), llm, undefined, sources);

  for (const prompt of promptsOf(llm)) {
    expect(prompt.user).toContain("Provider: Slack");
    expect(prompt.user).toContain("Provider: Salesforce");
    expect(prompt.user).toContain("conversational decisions");
    expect(prompt.user).toContain("structured records");
  }
});

it("uses a source added during an interview on the next turn", async () => {
  const iv = await createInterview({ topic: "Incident response" });
  const llm = fake([turn()], "How do you respond?");
  const opened = await runTurn(iv, llm);
  await appendMessage(opened.id, { role: "expert", content: "Use the incident channel." });
  await runTurn(
    (await getInterview(opened.id))!,
    llm,
    undefined,
    [readySource({ source_type: "slack", extracted_text: "Incident decision history" })],
  );
  expect(promptsOf(llm).at(-2)?.user).toContain("Provider: Slack");
  expect(promptsOf(llm).at(-1)?.user).toContain("Provider: Slack");
});
```

Also assert that material headings include `Provider: <name>` and that failed
sources do not contribute provider rules.

- [ ] **Step 2: Run the focused engine tests and verify RED**

Run:

```bash
cd server
npx vitest run src/interviews/engine.test.ts
```

Expected: the new assertions fail because prompts currently expose raw
`source_type` only as a URL fallback and contain no provider rule blocks.

- [ ] **Step 3: Add prompt integration**

In `sourceMaterial()`:

```ts
const docs = ready.map((source) =>
  `### ${source.title}\nProvider: ${sourceDisplayName(source.source_type)}\n`
  + `Source: ${source.url ?? "No source URL"}\n${source.extracted_text}`,
).join("\n\n");
```

Include `sourceGuidance(sources)` in the returned source-material prompt after
the document blocks. Preserve the legacy `source_context` path, but create
equivalent synthetic `InterviewSource` values from its documents so the
provider's rule block is also included.

Because both `buildUser()` and `buildInterviewerUser()` already call
`sourceMaterial()`, this single integration reaches both models.

- [ ] **Step 4: Run source and engine tests and verify GREEN**

Run:

```bash
cd server
npx vitest run src/interviews/sourceGuidance.test.ts src/interviews/engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit prompt integration**

```bash
git add server/src/interviews/engine.ts server/src/interviews/engine.test.ts
git commit -m "feat: make skill interviews source aware"
```

### Task 3: Regression verification and edge bundle

**Files:**
- Modify generated: `supabase/functions/brian/index.js`
- Modify generated: `supabase/functions/brian/index.ts`

**Interfaces:**
- Consumes: server source and passing server tests
- Produces: deployable edge bundle containing the provider-guidance registry

- [ ] **Step 1: Run the interview and API regression tests**

Run:

```bash
cd server
npx vitest run src/interviews/sourceGuidance.test.ts src/interviews/engine.test.ts src/api/interviewApi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run type checking**

Run:

```bash
cd server
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Regenerate the edge function**

Run:

```bash
cd server
npm run edge:build
```

Expected: `supabase/functions/brian/index.js` and
`supabase/functions/brian/index.ts` are regenerated successfully.

- [ ] **Step 4: Verify the generated bundle**

Run:

```bash
rg -n "Provider-specific source rules|Provider: Slack|Provider: Salesforce" \
  supabase/functions/brian/index.js supabase/functions/brian/index.ts
git diff --check
```

Expected: both generated files contain the source-aware prompt strings and
`git diff --check` reports no whitespace errors.

- [ ] **Step 5: Re-run focused tests after generation**

Run:

```bash
cd server
npx vitest run src/interviews/sourceGuidance.test.ts src/interviews/engine.test.ts src/api/interviewApi.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit generated artifacts**

```bash
git add supabase/functions/brian/index.js supabase/functions/brian/index.ts
git commit -m "build: bundle source-aware interview prompts"
```

