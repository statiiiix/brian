# Knowledge Capture & Ingestion v2 — Design

> Builds on [`2026-06-29-company-brain-design.md`](./2026-06-29-company-brain-design.md)
> and the v1 backend. Source of product truth remains [`CompanyBrain.md`](../../../CompanyBrain.md).
> Brainstormed and approved 2026-06-29.

## Goal

Let the brain be *fed* with little human effort and stay accurate over time. Add a
**capture connector usable from inside Claude**: after a working session, the user
runs it; it processes what was said, and files each piece into the right place so
future agent runs already know the user's goals, decisions, and processes.

## Core decisions (from brainstorming)

1. **Two knowledge types.** Add `context` alongside `skill`.
   - **skill** = how to DO a process (executable; can call tools). Unchanged from v1.
   - **context** = what is true / what the user wants (goals, decisions, preferences).
     Informs the agent; never executes; has no tools.
2. **Classify-and-route.** `capture(text)` asks Claude to segment the input into
   discrete items, classify each `skill` or `context` with a confidence score, and
   structure it. Each item is then routed: if it semantically matches an existing
   entry it becomes an **update** (new version, history kept); otherwise a **create**.
3. **Graduated autonomy (the safety model).**
   - `context` → **always stored `active` immediately** (zero blast radius — only informs).
   - `skill` → stored/updated **`active` automatically iff** `confidence ≥ threshold`
     **AND** every referenced tool is in the **safe/reversible** tier. Otherwise the
     proposed skill lands as **`draft`** for one quick human review.
   - Run-time guardrails remain on every skill, so even an auto-activated skill STOPs
     and escalates at the risky branch. Skill updates create a new version (revertible),
     which is what makes confident auto-updates safe.
4. **Tool-risk registry.** Each tool is tagged `safe` (read-only/reversible) or
   `destructive` (irreversible). **Unknown tools default to `destructive`** (fail safe).
   This registry is the input to the reversibility gate.

## Architecture (additions to `server/`)

```
server/src/
├── context/                 # NEW: the second knowledge type
│   ├── types.ts             # ContextEntry, NewContext, ContextVersion
│   ├── validation.ts        # zod schemas
│   └── repo.ts              # CRUD, version history, findContext (pgvector)
├── mcp/
│   ├── toolRisk.ts          # NEW: tool risk registry + skillIsAutoSafe()
│   └── server.ts            # + capture, find_context tools
├── ingestion/
│   ├── capture.ts           # NEW: classify -> route -> autonomy-gate -> log
│   └── bulk.ts              # NEW: run capture over many docs
├── skills/repo.ts           # + findSkillWithDistance() for dedup routing
└── api/app.ts               # + /api/capture, /api/ingest/bulk, /api/context...
```

## Data model

```sql
create table context_entries (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,                 -- the knowledge, in the user's words (cleaned)
  summary     text,                          -- short summary (display + embedding)
  tags        jsonb not null default '[]',
  source      text,                          -- 'capture' | 'bulk:<name>' | 'manual'
  status      text not null default 'active',-- 'active' | 'retired'
  owner       text,
  version     int  not null default 1,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on context_entries using ivfflat (embedding vector_cosine_ops);

create table context_versions (
  id          uuid primary key default gen_random_uuid(),
  context_id  uuid not null references context_entries(id),
  version     int not null,
  snapshot    jsonb not null,
  changed_by  text,
  created_at  timestamptz not null default now()
);
```

Embedding source for a context entry: `summary` (falling back to `content`).

## The capture pipeline (`capture.ts`)

`capture(text, opts?): Promise<CaptureResult>`

1. **Extract** — Claude (`claude-sonnet-4-6`) returns a JSON array of items:
   ```ts
   type CapturedItem =
     | { kind: "context"; confidence: number; content: string; summary: string; tags: string[] }
     | { kind: "skill";   confidence: number; skill: NewSkill };
   ```
   Validated; malformed model output throws.
2. **Route each item:**
   - **context** → `findContextWithDistance(summary)`. If distance ≤ `SIM_MAX` → `updateContext`
     (new version). Else `createContext`. Always `status='active'`. Action recorded.
   - **skill** → `findSkillWithDistance(trigger+name)`. `auto = confidence ≥ CONF_MIN && skillIsAutoSafe(skill.tools)`.
     - matched + `auto` → `updateSkill` (live, new version) → ensure `active`. Action `updated_active`.
     - matched + not `auto` → `createSkill` as a proposed revision (`draft`). Action `proposed_draft`.
     - new + `auto` → `createSkill` then `setStatus active`. Action `created_active`.
     - new + not `auto` → `createSkill` (`draft`). Action `created_draft`.
3. **Result:**
   ```ts
   interface CaptureResult {
     items: Array<{ kind: "skill" | "context"; action: string; id: string; confidence: number }>;
   }
   ```

Tunables (env, with defaults): `CAPTURE_CONFIDENCE_MIN=0.75`, `CAPTURE_SIM_MAX=0.2`.

## Tool-risk registry (`toolRisk.ts`)

```ts
type ToolRisk = "safe" | "destructive";
// safe: get_order, lookup_customer, get_ticket, find_skill, get_skill, find_context
// destructive: issue_refund, post_reply, page_oncall
toolRisk(name): ToolRisk            // unknown -> "destructive"
skillIsAutoSafe(tools): boolean     // true iff every tool is "safe"
```

## Surfaces

- **MCP** (the in-Claude connector): `capture(text)` and `find_context(query)` added to
  the existing MCP server. Running `capture` from Claude Code is the user's workflow.
- **REST:**
  - `POST /api/capture` `{ text }` → `CaptureResult`
  - `POST /api/ingest/bulk` `{ docs: [{ source, text }] }` → `{ results: CaptureResult[] }`
  - `GET /api/context?status=` · `GET /api/context/:id` · `POST /api/context` ·
    `PUT /api/context/:id` · `POST /api/context/:id/retire` · `GET /api/context/:id/versions`
- **Run-time retrieval:** agents call **both** `find_skill` and `find_context`, so work
  is informed by the user's goals, not just processes.

## Error handling

- Malformed Claude output (not JSON / wrong shape) → throw; `/api/capture` returns `400 { error }`.
- Per-item failures in bulk ingestion are captured per-doc; one bad doc doesn't abort the batch.
- Unknown tool in a captured skill → treated `destructive` → routed to review (never silently auto-activated).

## Testing (TDD, real Postgres+pgvector)

- `toolRisk`: safe/destructive/unknown-defaults-destructive; `skillIsAutoSafe` all-safe vs mixed.
- `context/repo`: create/get/list/update(+version snapshot)/retire/findContext nearest.
- `capture` (mocked Claude):
  - context item → created `active`.
  - skill, high confidence + safe tools → `created_active`.
  - skill, destructive tool → `created_draft` even at high confidence.
  - skill, low confidence → `created_draft`.
  - matched existing context → `updateContext` new version (not duplicate).
- `bulk`: two docs → two `CaptureResult`s; one malformed doc doesn't kill the batch.
- API: `/api/capture` happy + 400; context CRUD; `/api/ingest/bulk`.
- MCP: `capture` and `find_context` tools return expected payloads.

## Out of scope (still deferred)

Third-party scheduled connectors (Slack/Gmail/Notion pollers), auth/multi-tenant,
the graph UI. The "connector" in v2 is the user-triggered in-Claude `capture`, not a
background poller.
