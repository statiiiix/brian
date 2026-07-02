# Brian-bench — design (Phase 1: retrieval at scale)

Date: 2026-07-02
Status: direction approved by founder ("start working on the things you recommended");
decisions delegated to the agent.

## Goal

Produce credible, quantified evidence for YC: **does `find_skill` return the right
skill when there are 100+ real skills, not 3?** Output is a number ("top-1 retrieval
accuracy at N skills") plus a failure analysis that drives fixes.

Phases 2 (500-email inbox marathon with adversarial slice, zero-guardrail-violation
report) and 3 (learning curve via capture) reuse this harness and corpus; they are
specced at the end but NOT built in Phase 1.

## Corpus: GitLab public handbook

Real company SOPs, public, huge, and legally usable (CC BY-SA). Fetch via shallow
sparse clone of `gitlab-com/content-sites/handbook` into the scratchpad. Select
~120 markdown pages, 2–15 KB each, spread across top-level handbook sections for
topical diversity. Deterministic selection (sorted, stride-sampled) so runs are
reproducible.

## Isolation: `bench` schema

Same trick as the `test` schema: rewrite `TEST_DATABASE_URL`'s
`search_path=test,public` to `search_path=bench,public`, `create schema if not
exists bench`, run the existing migrations. Live `public` and the `test` schema are
never touched. The bench DB persists between runs (ingestion is expensive); a
`bench -- reset` subcommand wipes it.

## Pipeline (npm run bench -- <cmd>)

1. `fetch` — sparse-clone the handbook, select pages, write a manifest
   (`page path → title`) to the scratchpad.
2. `ingest` — for each page: existing `draftFromText` pipeline drafts a skill
   (LLM), then activate it. Records `page → skill_id` mapping in a `bench_meta`
   table (created by the harness in the bench schema).
3. `queries` — for each page: one LLM call generates a short, natural task request
   a coworker would type, **from the raw page text, not the drafted skill**, with
   instructions to avoid reusing distinctive phrases (reduces circularity; noted
   honestly in the report).
4. `eval` — for each labeled query: `find_skill` (top-1) and new top-k retrieval;
   score top-1 accuracy and top-3 hit rate; dump per-miss diagnostics (expected vs
   got, distances).
5. `report` — write `docs/bench/YYYY-MM-DD-retrieval.md` with corpus size, accuracy,
   top-3 rate, miss table, and method caveats.

## New backend capability (the only src change)

`findSkillsWithDistance(query, k, pool)` in `skills/repo.ts` — top-k active skills
with cosine distances (generalizes the existing top-1). Unit-tested like existing
repo fns. This also unblocks the top-k `find_context`/`find_skill` MCP improvements
later.

## Costs / limits

~120 draft calls + ~120 query calls on `gpt-5.4-mini` + ~360 embeddings — cents.
Ingest is resumable (skips pages already in `bench_meta`).

## Testing

Pure logic (URL rewrite, page selection, scoring) is unit-tested with vitest, no
network/LLM. Pipeline steps are scripts, verified by running them for real. The
existing suite must stay green; nothing in the MCP/API surface changes except the
added repo function.

## Phase 2/3 (specced, not built now)

- **Marathon:** generate 500 inbox tasks (450 in-scope, 50 adversarial rule-breaking
  attempts) against a support-skill subset; drive the agent loop (find_skill →
  guardrail check → act/escalate → log_execution); report autonomous %, correct
  escalation %, hard-rule violations (target 0). Requires an agent-sim runner.
- **Learning curve:** run a fixed 100-task set weekly; after each run, capture
  corrections; chart unedited-output rate over runs.
