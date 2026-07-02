# Brian-bench Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.
> Executed inline by the session that wrote it; tasks are coarser than usual
> because the executor has full context and each step is verified by running it.

**Goal:** Measure `find_skill` top-1 accuracy against ~120 skills drafted from real
GitLab-handbook pages, in an isolated `bench` schema, and produce a results doc.

**Architecture:** One new repo function (`findSkillsWithDistance`, top-k). Everything
else lives in `server/src/bench/`: pure helpers (`lib.ts`, unit-tested) and a CLI
(`cli.ts`, `npm run bench -- <cmd>`) with subcommands `fetch | ingest | queries |
eval | report | reset`. Corpus + manifest live in the session scratchpad; results
in `docs/bench/`.

**Tech:** existing stack only (pg, openai via `LlmClient`, tsx). No new deps.

## Global constraints

- Bench DB = `TEST_DATABASE_URL` with `search_path=test,public` rewritten to
  `search_path=bench,public`. Never touch live `public` or `test`.
- Ingest/queries resumable via `bench_meta` table (`page` PK); re-runs skip done rows.
- Existing 74 tests stay green; `npm run build` stays clean.
- Query generation prompt must draw from raw page text and forbid copying
  distinctive phrases (anti-circularity), and the results doc must state the caveat.

### Task 1: `findSkillsWithDistance` (top-k retrieval)

**Files:** modify `server/src/skills/repo.ts`; test `server/src/skills/find.test.ts` (append).

Signature:
```ts
export async function findSkillsWithDistance(
  query: string, k: number, p: pg.Pool = defaultPool
): Promise<{ skill: Skill; distance: number }[]>  // active skills only, nearest first
```
SQL = existing `findSkill` query with `, embedding <=> $1::vector as distance` and
`limit $2`. Test (in existing DB-gated pattern): create 3 active skills with mocked
embeddings, assert k=2 returns 2 in distance order and excludes drafts. TDD, commit.

### Task 2: bench pure helpers

**Files:** create `server/src/bench/lib.ts`, `server/src/bench/lib.test.ts`.

```ts
export function benchUrl(testUrl: string): string        // rewrites search_path=test -> bench; throws if pattern missing
export interface PageFile { path: string; bytes: number }
export function selectPages(files: PageFile[], n: number, minB?: number, maxB?: number): string[]
// filter 2KB..15KB, exclude paths with "/_" or "index.md"? keep simple: filter size, sort by path,
// stride-sample evenly to n (deterministic).
```
Unit tests: URL rewrite happy/throw; selection is deterministic, size-filtered,
evenly strided. TDD, commit.

### Task 3: bench CLI

**Files:** create `server/src/bench/cli.ts`; add script `"bench": "tsx src/bench/cli.ts"`.

- Shared setup: `loadServerEnv()`; pool = `makePool(benchUrl(TEST_DATABASE_URL))`;
  `create schema if not exists bench`; `runMigrations(pool)`;
  `create table if not exists bench_meta (page text primary key, title text, skill_id uuid, query text)`.
- `fetch`: shallow sparse clone `https://gitlab.com/gitlab-com/content-sites/handbook.git`
  into `<scratchpad>/handbook` (skip if present); walk `content/handbook/**/*.md`,
  `selectPages(..., 120)`, write manifest JSON to `<scratchpad>/bench-manifest.json`.
- `ingest`: for each manifest page not in `bench_meta`: strip frontmatter, first
  `# heading` as title; LLM draft via `SKILL_JSON_SCHEMA` + `parseNewSkill` +
  `createSkill(input, pool)` + `setStatus(id, "active", pool)`; insert bench_meta row.
  Log progress; failures logged and skipped (don't abort the run).
- `queries`: for each bench_meta row with null query: LLM ("write ONE natural task
  request (max 25 words) a coworker would send that this process handles; do NOT
  reuse distinctive phrases from the doc") on raw page text; store in bench_meta.
- `eval`: for each row with a query: `findSkillsWithDistance(query, 3, pool)`;
  top-1 correct if `[0].skill.id === skill_id`; top-3 hit if any match. Write
  `<scratchpad>/bench-results.json` with per-query rows + summary.
- `report`: render `docs/bench/2026-07-02-retrieval.md` from results JSON: corpus
  size, accuracy, top3 rate, worst-10 misses table (query, expected title, got
  title, distance gap), method + caveats.
- `reset`: `drop schema bench cascade`.
Commit after CLI builds and `fetch` works.

### Task 4: run it live

`npm run bench -- fetch` → `ingest` → `queries` → `eval` → `report`. Sanity-check a
few drafted skills by eye (`bench_meta` join `skills`). Commit results doc.

### Task 5: verify + integrate

Full suite + `npm run build` green → merge `brian-bench` to `main` (repo precedent:
local no-ff merge), delete branch.
