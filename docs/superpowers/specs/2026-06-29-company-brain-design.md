# Company Brain ("Brian") — v1 Design

> Source of truth: [`CompanyBrain.md`](../../../CompanyBrain.md). This doc records the
> decisions that spec left open and the v1 build scope agreed during brainstorming
> on 2026-06-29. Where this doc and `CompanyBrain.md` agree, `CompanyBrain.md` wins
> on intent; this doc wins on concrete tech choices.

## Core thesis (unchanged from spec)

A Company Brain turns a company's tacit processes into **executable skills** an AI
agent can follow to *do the work* — reliably, within the company's real rules.
The win condition for v1 is **one real skill executed correctly by an agent, end to
end, with the execution logged.** Build inside-out from a single working skill.

## Scope decision (brainstorming outcome)

The founder's steer: build the *whole* Company Brain, **generic and not tied to one
vertical**, that ingests company knowledge and organizes it so the agent performs
well. Reconciliation:

- **Build now:** the full generic engine (DB, MCP execution, retrieval, REST API,
  feedback loop) **plus assisted ingestion** (`draft-from-text`: paste company data
  → Claude drafts a structured skill → human approves). Seed with 2 generic example
  skills purely to prove the loop.
- **Explicitly deferred (v1 anti-goal):** automated live connectors
  (Slack/Gmail/Notion background pipelines). Worthless until the execution loop is
  proven; revisit only after M4 works. Also deferred per spec: graph DB, graph UI,
  generic RAG, auto-skills going live unreviewed, breadth before one skill works.

No vertical is chosen. The engine is vertical-agnostic; the only vertical-specific
thing is the *text content* of individual skills, authored later via the API.

## Architecture

```
brian/ (repo root)
├── src/, public/        # CRA — the founder's React UI (NOT built by the agent)
├── server/              # the agent's deliverable — standalone TS backend
│   ├── db/              # pg pool, migrations, embedding helper
│   ├── skills/          # skill data-access + validation (the data model)
│   ├── api/             # Fastify routes implementing the JSON contract
│   ├── mcp/             # MCP server: skill tools + mock business tools
│   ├── ingestion/       # draft-from-text (Claude drafts a skill from pasted text)
│   ├── feedback/        # execution logging, staleness, version history
│   └── test/            # Vitest unit + one end-to-end loop test
└── docs/superpowers/specs/
```

**Decoupling:** the React UI and the backend share no code — only the documented
JSON contract. The backend is a standalone Node/TypeScript service (not Next.js,
to avoid restructuring the existing CRA).

### Tech choices

| Concern | Choice | Why |
|---|---|---|
| Backend framework | **Fastify** (TypeScript) | Clean JSON, built-in JSON-schema validation for the spec's "validate every write" requirement |
| DB | **Supabase Postgres + pgvector** | Per spec; Supabase MCP available for provisioning |
| Embeddings | **OpenAI `text-embedding-3-small` (1536 dims)** | Anthropic has **no** embeddings API; this keeps the spec's `vector(1536)` column exactly as written and enables true pgvector search |
| Retrieval | **pgvector cosine similarity** over `active` skills | Real semantic `find_skill`, as the spec's M2 describes |
| Execution reasoning | **Claude (Anthropic API)** | The agent driving the MCP tools |
| `draft-from-text` | **Claude `claude-sonnet-4-6`** server-side | Strong-enough drafting; returns `draft` status for human review |
| Tests | **Vitest** | Fast TS test runner |

> When writing any code that calls the Anthropic API, consult the `claude-api`
> skill for current model IDs and SDK usage before coding. Model IDs in use:
> `claude-sonnet-4-6` (draft-from-text). The execution agent uses whichever Claude
> model drives the MCP session.

## Data model (from spec, unchanged)

Tables: `skills`, `skill_versions`, `skill_links`, `executions` — exactly the SQL in
`CompanyBrain.md`. `skills.embedding` is `vector(1536)` and is populated on create
and on any edit that changes `name`/`trigger`/`procedure`. ivfflat cosine index.

The `Skill` TypeScript type and `SkillStatus` are as defined in the spec.

## Components & responsibilities

1. **`db/`** — single `pg` pool; a `migrate` step that runs the spec's SQL idempotently;
   `embed(text): number[]` helper wrapping the OpenAI embeddings call. One clear job:
   talk to Postgres + produce embeddings.
2. **`skills/`** — data access (`createSkill`, `getSkill`, `listSkills`, `updateSkill`,
   `activate`, `retire`, `findSkillByVector`) and schema validation. On update: snapshot
   prior state to `skill_versions`, bump `version`, re-embed if needed.
3. **`api/`** — Fastify routes mapping 1:1 to the JSON contract. Pure transport: validate
   input, call `skills/`/`ingestion/`/`feedback/`, return JSON. Errors → `{ error }` + status.
4. **`mcp/`** — MCP server exposing `find_skill(query)`, `get_skill(id)`, and mock business
   tools `get_order(order_id)`, `issue_refund(order_id, amount)` over fixture data.
5. **`ingestion/`** — `draftFromText(text)`: Claude returns a skill object in the schema,
   status forced to `draft`. Never auto-activates.
6. **`feedback/`** — `logExecution(...)`; `markStale()` (sets `needs_review` where
   `last_reviewed_at` older than N days); reads for execution/version history endpoints.

## Data flow — the win-condition loop (M3)

1. Agent receives a task (e.g. "customer X wants a refund on order Y").
2. Agent calls `find_skill("customer refund request")` → embeds query → pgvector search
   over `active` skills → returns the full Refund skill.
3. Agent reads procedure + hard_rules + guardrails + examples.
4. Agent gathers inputs via `get_order` (mock).
5. **Guardrail check:** if a guardrail trips (amount > $200, enterprise tier, order not
   found) → STOP and escalate; do NOT act.
6. Else execute within hard_rules via `issue_refund` (mock).
7. `logExecution` writes a row to `executions` (skill_id, version, task_input,
   actions_taken, outcome, human_override).

## REST/JSON API contract (from spec)

```
GET    /api/skills                      -> Skill[]   (filterable by status)
GET    /api/skills/:id                  -> Skill
POST   /api/skills                      -> Skill     (create, status 'draft')
PUT    /api/skills/:id                  -> Skill     (edit; bumps version + history)
POST   /api/skills/:id/activate         -> Skill
POST   /api/skills/:id/retire           -> Skill
GET    /api/skills/:id/versions         -> SkillVersion[]
GET    /api/skills/:id/executions       -> Execution[]
POST   /api/skills/:id/draft-from-text  -> Skill     (Claude drafts from pasted text)
GET    /api/executions                  -> Execution[]
```

All writes validate against the schema and return the updated object.

## Error handling

- API: validation failure → `400 { error }`; not found → `404 { error }`; unexpected →
  `500 { error }` (no internals leaked).
- MCP: `find_skill` with no confident match returns an explicit "no matching skill"
  result so the agent escalates rather than guessing.
- Execution: any tool error or tripped guardrail → outcome recorded (`escalated`/`failed`),
  never a silent action.

## Testing strategy

- **Unit (Vitest):** skill validation; version-snapshot-on-edit; staleness detection;
  embedding helper (mocked); each API route (happy + error path).
- **End-to-end (the win condition):** drive the loop on two refund cases — one that
  completes (small, in-window) and one that trips a guardrail (>$200 → escalates) —
  and assert an `executions` row is written with the correct outcome each time.

## Build order (milestones, from spec)

- **M0** Schema + migrations + `embed()` helper.
- **M1** Create/read/update API + 2 hand-authored seed skills stored `active`.
- **M2** `find_skill` via pgvector; prove it returns the right skill for NL queries.
- **M3** MCP server + mock tools; agent runs one skill end to end respecting
  hard_rules/guardrails. **← single most valuable milestone.**
- **M4** Execution logging + staleness + version history.
- **M5** Finish full API surface incl. `draft-from-text` for the UI.

## Out of scope for v1

Automated connectors, graph DB, graph UI, generic RAG, unreviewed auto-skills,
background job queue, multi-tenant auth. Flag if asked to build any before M4 works.
