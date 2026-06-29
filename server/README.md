# Brian — Company Brain backend

Standalone TypeScript service. See `../CompanyBrain.md` and
`../docs/superpowers/specs/2026-06-29-company-brain-design.md`.

## Setup
1. `cp .env.example .env` and fill in `DATABASE_URL` (Supabase) and `OPENAI_API_KEY`.
   The generative LLM (skill drafting + capture) uses OpenAI; model is `LLM_MODEL` (default `gpt-5.4-mini`).
2. `npm install`
3. `npm run migrate`   # create tables + pgvector
4. `npm run seed`      # 2 active example skills

## Run
- `npm run api`  → REST API on :3001 (the React UI's contract)
- `npm run mcp`  → MCP server on stdio (for an agent to execute skills)

## Test
Set `TEST_DATABASE_URL` to a Postgres+pgvector DB, then `npm test`.
DB-backed tests are skipped if it is unset; pure-logic tests always run.

## Knowledge capture (v2)
The brain stores two things: **skills** (executable processes) and **context**
(goals/decisions/preferences that inform the agent).

- `POST /api/capture { text }` — classify a work session into skills/context and file each.
  - context → stored active immediately.
  - skill → active only if confident AND all tools are reversible; else draft for review.
- `POST /api/ingest/bulk { docs: [{source,text}] }` — run capture over many docs (failures isolated per doc).
- Context CRUD: `GET/POST /api/context`, `GET/PUT /api/context/:id`, `POST /api/context/:id/retire`, `GET /api/context/:id/versions`.
- MCP tools `capture` and `find_context` expose the same to an agent inside Claude.

Tunables: `CAPTURE_CONFIDENCE_MIN` (default 0.75), `CAPTURE_SIM_MAX` (default 0.2).
