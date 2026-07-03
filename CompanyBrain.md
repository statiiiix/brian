# CompanyBrain.md

> Build spec for **Brian — a Company Brain**.
> Hand this file to the Claude Code agent as the source of truth for what to build and in what order.
> Read this whole file before writing any code. When in doubt, re-read the "Core Thesis" and "Anti-Goals" sections — they exist to stop drift.

---

## Core Thesis (read this first, do not skip)

A Company Brain is **not** a search engine, **not** a chatbot over documents, and **not** a knowledge graph for its own sake.

It is a system that turns a company's tacit processes into **executable skills** that an AI agent can follow to *do the work* — reliably, consistently, and within the company's real rules.

One **skill** = one process. Examples: "how refunds get handled," "how a pricing exception is approved," "how an engineer responds to a Sev-2 incident." A skill is a structured spec the agent reads and follows, with the company's specific decision logic and hard rules baked in.

The product's value is two things, in this order:

1. **Can an agent execute one real skill correctly, end to end?** (This is the whole game.)
2. **Does the skill stay current as the company changes?** (This is the moat.)

Everything else — connectors, graph visualizations, multi-source ingestion — is secondary and comes later. Build inside-out from a single working skill.

---

## Anti-Goals (do NOT build these first, and flag if asked to)

- ❌ A graph database (Neo4j, etc.). Relationships are foreign keys in Postgres for now.
- ❌ An Obsidian-style graph UI. A plain table of skills with editing beats it. Build later, if ever.
- ❌ Automated ingestion connectors (Slack/Gmail/Notion pipelines). Hand-author skills first.
- ❌ Generic RAG / "chat with your docs." That is not this product.
- ❌ Auto-generated skills that go live without a human approving them. Every skill is human-reviewed before it's active.
- ❌ Supporting many processes before ONE process works end to end.

If a request would pull the build toward any of these before the core loop works, pause and surface it.

---

## Tech Stack

- **Backend / API:** Next.js (App Router) API routes, or a standalone Node/TypeScript service — agent's choice, keep it simple.
- **Database:** Postgres (Supabase) with the `pgvector` extension.
- **Embeddings + reasoning:** Claude models via the Anthropic API. Use a small/fast model for embeddings-adjacent classification and a stronger model for execution reasoning.
- **Execution layer:** an MCP server (TypeScript) that exposes skills and business tools to the agent.
- **UI:** React + plain CSS (built separately by the founder — see "UI Contract"). The backend must expose clean JSON endpoints; do not couple business logic to the UI.
- **Background jobs (later only):** pg-boss or BullMQ. Not needed for the core loop.

---

## Division of Work

- **The agent (Claude Code) builds:** the database schema, the skill data model, the MCP execution server, the REST/JSON API, execution logging, and the feedback loop.
- **The founder builds:** the React + CSS UI, against the JSON API contract defined below.

Keep these decoupled. The UI talks to the backend only through the documented JSON endpoints.

---

## The Skill Schema (the heart of the product)

This is the single most important design decision. Get it right before anything else.

A skill is a structured object with these fields:

| Field | Purpose |
|---|---|
| `id` | Unique identifier |
| `name` | Human name, e.g. "Refund Handling" |
| `trigger` | When this skill applies, in plain language. Used for retrieval. |
| `inputs` | What information the skill needs to run (e.g. order ID, customer tier, reason) |
| `procedure` | The actual step-by-step decision logic, in plain language an agent can follow. **This is the meat.** |
| `hard_rules` | Non-negotiable policy constraints (e.g. "never refund > $200 without manager approval") |
| `tools` | The data lookups / actions this skill needs (references to MCP tools, e.g. `get_order`, `issue_refund`) |
| `guardrails` | Conditions under which the agent must STOP and escalate to a human |
| `escalation_target` | Who/where to escalate to |
| `examples` | 2–3 worked cases done correctly, for the agent to pattern off |
| `owner` | The human responsible for keeping this skill accurate |
| `status` | `draft` \| `active` \| `needs_review` \| `retired` |
| `version` | Integer, incremented on each edit |
| `last_reviewed_at` | Timestamp; drives staleness detection |
| `created_at`, `updated_at` | Standard timestamps |
| `embedding` | pgvector embedding of `trigger` + `name` + `procedure`, for semantic retrieval |

### TypeScript type

```ts
type SkillStatus = "draft" | "active" | "needs_review" | "retired";

interface SkillExample {
  scenario: string;       // the situation
  correct_action: string; // what the right outcome/steps were
}

interface Skill {
  id: string;
  name: string;
  trigger: string;
  inputs: string[];
  procedure: string;          // plain-language steps + decision logic
  hard_rules: string[];
  tools: string[];            // names of MCP tools this skill may call
  guardrails: string[];       // when to stop and escalate
  escalation_target: string;
  examples: SkillExample[];
  owner: string;
  status: SkillStatus;
  version: number;
  last_reviewed_at: string;   // ISO timestamp
  created_at: string;
  updated_at: string;
}
```

### Postgres schema

```sql
create extension if not exists vector;

create table skills (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  trigger         text not null,
  inputs          jsonb not null default '[]',
  procedure       text not null,
  hard_rules      jsonb not null default '[]',
  tools           jsonb not null default '[]',
  guardrails      jsonb not null default '[]',
  escalation_target text,
  examples        jsonb not null default '[]',
  owner           text,
  status          text not null default 'draft',
  version         int  not null default 1,
  last_reviewed_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  embedding       vector(1536)   -- match your embedding dimension
);

create index on skills using ivfflat (embedding vector_cosine_ops);

-- version history: never lose a prior version of a skill
create table skill_versions (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references skills(id),
  version     int not null,
  snapshot    jsonb not null,        -- full skill object at that version
  changed_by  text,
  created_at  timestamptz not null default now()
);

-- relationships between skills/policies as simple FKs, NOT a graph DB
create table skill_links (
  id            uuid primary key default gen_random_uuid(),
  from_skill_id uuid not null references skills(id),
  to_skill_id   uuid not null references skills(id),
  relation      text not null   -- e.g. 'depends_on', 'escalates_to'
);
```

---

## The Execution Layer (MCP Server)

This is how the agent actually does work. Build a small MCP server in TypeScript exposing two categories of tools.

**1. Skill tools (always present):**
- `find_skill(query: string)` → embeds the query, does a pgvector similarity search over `active` skills, returns the best-matching skill object (full procedure, hard rules, guardrails, examples) for the agent to read and follow.
- `get_skill(id: string)` → returns a specific skill by id.

**2. Business tools (per skill, defined by what the process needs):**
- e.g. `get_order(order_id)`, `issue_refund(order_id, amount)`, `lookup_customer(email)`.
- For the first build, these can hit a sandbox/mock data source. The point is to prove the loop, not to integrate production systems yet.

**Execution flow the agent follows:**
1. Agent receives a task ("customer X wants a refund on order Y").
2. Agent calls `find_skill("customer refund request")` → gets the Refund skill.
3. Agent reads the procedure, hard rules, and guardrails.
4. Agent gathers inputs using business tools (`get_order`).
5. Agent checks guardrails. If a guardrail trips (e.g. amount > threshold, enterprise tier), it STOPS and escalates instead of acting.
6. Otherwise it executes the procedure (`issue_refund`) within the hard rules.
7. Every step is logged (see Feedback Loop).

The agent must never act outside a skill's hard rules, and must always prefer escalation when a guardrail condition is met.

---

## The Feedback Loop (the moat)

A Company Brain that goes stale in three weeks is worthless. Even a crude version of this matters more than any UI feature.

**Execution log** — every skill execution writes a row:

```sql
create table executions (
  id            uuid primary key default gen_random_uuid(),
  skill_id      uuid references skills(id),
  skill_version int,
  task_input    jsonb,        -- what the agent was asked to do
  actions_taken jsonb,        -- tools called + arguments + results
  outcome       text,         -- 'completed' | 'escalated' | 'failed'
  human_override jsonb,       -- if a human corrected or reversed the agent
  created_at    timestamptz not null default now()
);
```

**Staleness + quality signals:**
- A skill whose `last_reviewed_at` is older than N days → mark `needs_review` and surface to its `owner`.
- A skill with repeated `failed` outcomes or frequent `human_override` → flag for its owner to fix.
- When a skill is edited, write the prior state to `skill_versions` and bump `version`.

This loop is what makes the brain *living* rather than a stale doc dump.

---

## Knowledge Ingestion (hand-author first)

Do this in strict phases. Do not skip ahead.

- **Phase 1 — Hand-author.** A human (the founder, with Claude's help) writes the first skill by interviewing the person who owns the process and reading their real docs. The skill is created via the API in `draft`, reviewed, then set `active`. **This is the only ingestion needed for the core loop.**
- **Phase 2 — Assisted drafting.** Point Claude at a pasted document / ticket history / Slack export and have it *draft* a skill in the schema. A human reviews and approves before it becomes `active`. Auto-extracted skills NEVER go live unreviewed.
- **Phase 3 — Connectors (much later).** Background jobs pull from sources on a schedule and propose skill updates for human review. Not part of the initial build.

---

## REST / JSON API Contract (for the React UI)

The backend exposes these endpoints. The founder's React app consumes them. Keep responses as plain JSON matching the `Skill` type above.

```
GET    /api/skills                 -> Skill[]            (list, filterable by status)
GET    /api/skills/:id             -> Skill
POST   /api/skills                 -> Skill              (create, defaults to status 'draft')
PUT    /api/skills/:id             -> Skill              (edit; bumps version, writes history)
POST   /api/skills/:id/activate    -> Skill              (draft -> active)
POST   /api/skills/:id/retire      -> Skill              (-> retired)
GET    /api/skills/:id/versions    -> SkillVersion[]     (version history)
GET    /api/skills/:id/executions  -> Execution[]        (execution log for this skill)
POST   /api/skills/:id/draft-from-text -> Skill          (Phase 2: Claude drafts a skill from pasted text)
GET    /api/executions             -> Execution[]        (recent executions across all skills)
```

All write endpoints validate against the schema and return the updated object. Errors return `{ error: string }` with an appropriate status code.

---

## UI Contract (built by founder in React + CSS)

The agent does NOT build this, but should expose the API to support these views:

1. **Skill list** — table of all skills: name, owner, status, last reviewed, version. Filter by status. This is the primary view; it intentionally replaces the fancy graph.
2. **Skill detail / editor** — view and edit every field of a skill. Show version history. Activate / retire buttons.
3. **Skill draft-from-text** — paste a doc, get a draft skill back to review and edit before saving.
4. **Execution log** — recent executions, outcome, whether a human overrode the agent. Highlight skills flagged `needs_review`.

Plain CSS is fine. The graph visualization is explicitly out of scope for v1.

---

## Build Order (milestones)

Build in this exact sequence. Each milestone should work before starting the next.

- **M0 — Schema.** Stand up Postgres + pgvector. Create the `skills`, `skill_versions`, `skill_links`, `executions` tables. Write the embedding helper.
- **M1 — One skill, by hand.** Build the create/read/update API. Hand-author ONE real skill for the chosen process and store it as `active`.
- **M2 — Retrieval.** Implement `find_skill` with pgvector similarity search. Prove it returns the right skill for a natural-language query.
- **M3 — MCP server + execution.** Build the MCP server exposing `find_skill`, `get_skill`, and 1–2 mock business tools. Wire Claude up to retrieve the skill and run the process end to end on a test case, respecting hard rules and guardrails.
- **M4 — Logging + feedback.** Write to the `executions` table on every run. Implement staleness detection (`needs_review`) and version history on edit.
- **M5 — API surface for UI.** Finish all endpoints in the API contract so the React UI can be built against them. (Phase 2 draft-from-text can land here or just after.)

A working M3 — one skill, executed correctly by an agent end to end — is the single most valuable thing to have. Prioritize reaching it over breadth.

---

## Open Decision (founder must specify)

The first skill's `tools`, `hard_rules`, and `guardrails` depend entirely on **which process and vertical** we're encoding first. The schema and infrastructure are generic; the first filled-in skill is not. Before M1, fill in:

- **Vertical:** _e.g. e-commerce, SaaS support, fintech ops_
- **First process:** _e.g. refund handling, pricing-exception approval, incident response, customer onboarding_
- **The 3–5 hard rules** that process must never violate.
- **The 1–2 business tools** that process needs (what it reads, what it does).

Until these are filled in, use the **Refund Handling** example below as a placeholder to build the plumbing against — but replace it with the real process before M1 is considered done.

---

## Placeholder Example Skill (replace with the real one)

```json
{
  "name": "Refund Handling",
  "trigger": "A customer requests a refund on a past order.",
  "inputs": ["order_id", "customer_email", "reason"],
  "procedure": "1. Look up the order. 2. Check the order date. 3. If within the refund window and the reason is valid, issue the refund for the order amount. 4. Confirm to the customer. 5. If the order is outside the window or the amount is large, follow the guardrails.",
  "hard_rules": [
    "Never refund an order older than 90 days.",
    "Never refund more than $200 without manager approval.",
    "Never issue a refund to an account other than the one that placed the order."
  ],
  "tools": ["get_order", "issue_refund"],
  "guardrails": [
    "If refund amount > $200, STOP and escalate.",
    "If the customer is on an enterprise plan, STOP and escalate.",
    "If the order cannot be found, STOP and escalate."
  ],
  "escalation_target": "Support team lead",
  "examples": [
    {
      "scenario": "Customer requests refund on a $40 order placed 5 days ago, item defective.",
      "correct_action": "Within window, under threshold, valid reason -> issue $40 refund and confirm."
    },
    {
      "scenario": "Customer requests refund on a $350 order.",
      "correct_action": "Over $200 threshold -> do NOT refund; escalate to support team lead."
    }
  ],
  "owner": "Support team lead",
  "status": "active",
  "version": 1
}
```

---

## Summary for the Agent

Build inside-out: schema → one hand-written skill → retrieval → MCP execution → logging/feedback → API. Keep relationships as Postgres foreign keys, keep ingestion manual, keep the UI to a plain table. The win condition for v1 is **one real skill executed correctly by an agent, end to end, with the execution logged.** Resist every temptation to build breadth, graphs, or connectors before that works.
