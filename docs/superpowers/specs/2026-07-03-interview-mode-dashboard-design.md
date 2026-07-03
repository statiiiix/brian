# Interview Mode + Dashboard — Design

Date: 2026-07-03
Status: approved (brainstormed with founder; decisions recorded from Q&A)

## Goal

Attack the "knowledge lives in people's heads" part of the company-brain vision:
Brian actively **interviews** a process owner in a chat UI, one question at a time,
until it can draft a complete skill — which the expert approves on the spot.
Ship it inside a real **web dashboard** (login, skill list/editor, review queue,
capture box, execution log) that shares the landing page's design language.

Connectors (Slack/Gmail/tickets) were chosen as the next milestone after this one;
this milestone builds the shared review surface they will feed into.

## Decisions made during brainstorming

1. **Order:** Interview mode first, connectors second (separate spec later).
2. **Auth scope:** Real `users` table (email + bcrypt password hash, JWT session),
   single workspace — everyone sees the same brain. No public dashboard signup:
   the business funnel is "sign up → schedule meeting → we provision sub-accounts"
   (later). For now, seed ONE admin user (founder's email `a7madokss@gmail.com`)
   so the founder can test everything. Multi-tenancy stays deferred.
3. **Interview flow:** Admin starts an interview ("New interview", names the
   process, optionally the owner). Brian asks one question per turn until it can
   fill every skill field, then shows the drafted skill next to the chat. The
   interviewee (the expert) can approve it → `active`, or leave it as `draft`
   in the review queue.
4. **Dashboard scope:** everything — interview chat, review queue, skill list +
   detail/editor, capture box, execution log. Plus a "Log in" button in the
   landing-page nav.
5. **Engine design:** one Structured-Outputs LLM call per turn (same pattern as
   `capture`): input = topic + transcript; output = either the next question or
   the finished draft, plus a **coverage map** of which skill fields are
   considered filled (rendered as a live progress checklist in the UI).
   No phased state machine; no agentic tools in v1 (can layer later).

## Architecture

### Backend (`server/`, existing Fastify + pg + pgvector app)

**Migration `004_users_interviews.sql`** (convergent, like existing migrations):

```sql
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text,
  role          text not null default 'admin',
  created_at    timestamptz not null default now()
);

create table if not exists interviews (
  id                 uuid primary key default gen_random_uuid(),
  topic              text not null,
  owner              text,                -- process owner (becomes skill.owner)
  status             text not null default 'active',  -- active | ready | completed | abandoned
  messages           jsonb not null default '[]',     -- [{role:'brian'|'expert', content, at}]
  coverage           jsonb not null default '{}',     -- {trigger:bool, inputs:bool, ...}
  draft              jsonb,               -- latest skill draft produced by the engine
  resulting_skill_id uuid references skills(id),
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

RLS enabled on both (backend connects as owner, same as existing tables).

**Auth (`src/auth/`):**
- `POST /api/auth/login {email, password}` → `{token, user}` (JWT, HS256, secret
  `AUTH_JWT_SECRET` from env, 7-day expiry). bcrypt compare.
- `GET /api/auth/me` → current user from JWT.
- Existing bearer guard extended: `/api/*` and `/mcp` accept **either** the static
  `BRIAN_API_TOKEN` (agents/MCP) **or** a valid user JWT (dashboard). Login route
  itself is public.
- Seed script `npm run seed:admin` upserts the founder admin user; the bcrypt hash
  is computed at seed time from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars (values
  live in gitignored `server/.env`, never in the repo).

**Interview engine (`src/interviews/`):**
- `repo.ts` — CRUD on `interviews`.
- `engine.ts` — `nextTurn(interview, expertMessage?)`:
  builds prompt (skill schema + topic + transcript), one Structured-Outputs call:

```ts
{
  status: 'asking' | 'ready',
  question?: string,          // when asking
  coverage: { trigger, inputs, procedure, hard_rules,
              guardrails, escalation_target, examples: boolean },
  draft?: SkillDraft          // full skill fields, when ready
}
```

- When `status='ready'`: persist `draft` on the interview (status `ready`).
  Approval endpoint creates the skill via the existing skills repo as `draft`,
  then activates it (existing activate path: version history, embedding), sets
  `resulting_skill_id`, interview → `completed`. "Save as draft" does the same
  minus activation.
- Guardrail: max 25 turns → engine must return `ready` with its best draft.

**REST endpoints (added to existing API):**

```
POST /api/auth/login
GET  /api/auth/me
POST /api/interviews                    {topic, owner?} → Interview (+ first question)
GET  /api/interviews                    → Interview[] (newest first)
GET  /api/interviews/:id               → Interview
POST /api/interviews/:id/messages       {content} → updated Interview (next question or ready+draft)
POST /api/interviews/:id/approve        {activate: boolean} → {interview, skill}
POST /api/interviews/:id/abandon        → Interview
```

Existing endpoints (skills CRUD, activate/retire, versions, executions, capture)
are reused by the dashboard unchanged.

### Frontend (CRA at repo root — same app as the landing page)

- Add `react-router-dom`. Routes: `/` (existing landing), `/login`,
  `/app` (dashboard shell with sidebar) → `/app/skills`, `/app/skills/:id`,
  `/app/review`, `/app/interviews`, `/app/interviews/:id`, `/app/capture`,
  `/app/executions`.
- Landing nav gets a **Log in** link (ghost button) next to "Get a demo".
- JWT kept in `localStorage`; API client sends `Authorization: Bearer <jwt>`;
  unauthenticated `/app/*` redirects to `/login`. CRA dev `proxy` → Fastify.
- Design language: reuse the landing tokens (dark `#0a0a0b`, Inter + JetBrains
  Mono, amber accent `#f5a623`, hairline borders, green/red status colors).
  Dashboard built with the ui-ux-pro-max skill guidance at implementation time.

**Views:**
1. **Skills** — table (name, owner, status badge, version, last reviewed) with
   status filter; detail page edits every field, shows version history,
   activate/retire.
2. **Review queue** — `draft` + `needs_review` skills, diff-style detail,
   approve (activate) / reject (retire) — web replacement for the review CLI.
3. **Interviews** — list + "New interview" (topic, owner); chat view: message
   thread, live coverage checklist (7 fields), and when ready a side-by-side
   draft panel with "Approve & activate" / "Save as draft".
4. **Capture** — textarea → existing `capture` pipeline; result cards show what
   was filed where (skill/context, created/updated, active/draft).
5. **Executions** — read-only table: skill, outcome (completed/escalated/failed),
   human override flag, time.

## Data flow (interview happy path)

1. Founder logs in → `POST /api/interviews {topic:"How we handle refunds", owner:"Sameh"}`.
2. Engine returns first question; each expert reply → one LLM call → next
   question + updated coverage.
3. Coverage complete → `status:'ready'` + full draft rendered beside the chat.
4. Expert clicks **Approve & activate** → skill created via existing pipeline
   (embedding, version history) → immediately retrievable by `find_skill`.
5. Execution log shows agent runs against it; review queue stays empty.

## Error handling

- LLM output failing zod → retry once, then surface "Brian had trouble" with a
  retry button (turn is idempotent: expert message persisted before LLM call).
- Auth failures → 401 JSON; frontend redirects to `/login`.
- Interview on a topic overlapping an existing skill: out of scope v1 (no
  find_skill check — noted as the "agentic interviewer" later layer).

## Testing

- Same stack as existing code (Vitest, test schema, mocked LlmClient; only DB real).
- Engine: mocked-LLM unit tests (asking→ready progression, coverage passthrough,
  25-turn cap, zod-failure retry).
- Repo + API tests for auth (login ok/bad password/expired token; static token
  still works) and interview endpoints (approve creates + activates skill,
  writes version history).
- UI: existing CRA test setup; smoke tests for login redirect and interview flow
  with mocked fetch.

## Out of scope (this milestone)

- Connectors (next milestone — will reuse the review queue).
- Public signup / meeting scheduling / sub-account provisioning flows.
- Multi-tenancy, cloud hosting, agentic interviewer tools, gap-driven interviews.
