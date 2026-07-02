# Brian-bench: retrieval at scale — 2026-07-02

**Corpus:** 120 active skills drafted from real GitLab-handbook pages (CC BY-SA).
**Labeled queries:** 120 (LLM-generated task requests from the raw pages,
instructed to avoid the documents' distinctive phrasing).

| Metric | Result |
|---|---|
| Top-1 accuracy (`find_skill`) | **102/120 (85.0%)** |
| Top-3 hit rate | 110/120 (91.7%) |

## Sample misses (first 10)

| Query | Expected | Got (top-1) | dist gap (got vs expected in top-3) |
|---|---|---|---|
| Please help me turn this registration page into a cleaner lead capture | GitLab for Remote Teams | Lead Lifecycle Management | not in top-3 |
| Can you help me map out the order-to-cash process and highlight gaps i | Purchasing Reliability Working Group | Getting Started with Agile/DevOps Metric | not in top-3 |
| Can you review our GitLab setup and tell us what to change before we a | Scoping a Readiness Assessment | Create an Organizational Structure in Gi | not in top-3 |
| Can you review my merge request and tell me if it’s ready to merge? | Static Analysis Group Code Review Proces | Working merge requests | 0.0703 |
| Can someone review my MR and let me know if it’s ready to merge? | Distribution Team Merge Request Handling | Working merge requests | 0.0482 |
| Can you help me set up a Slack workflow to turn team questions into tr | Infrastructure Platforms Department Requ | Pairify pairing session recording | 0.0045 |
| Can you help review my draft before tomorrow’s meeting? | Matt Nohr's README | WIR Podcast Production | not in top-3 |
| Can you summarize this strategy into a one-page exec brief with the ma | Open Source Growth Strategy | Sales Kickoff 2020 | not in top-3 |
| Can you help clean up the customer sales data and confirm the dashboar | Data Stewardship Practices | Support Engineering Data Analysis Commun | not in top-3 |
| Can you help me pull our deploy frequency, lead time, and recovery tim | Getting Started with Agile/DevOps Metric | Support Engineering Data Analysis Commun | 0.0051 |

## What the bench caught (the headline)

The first run scored **12.5% top-1 — with 28/120 queries returning ZERO results.**
Root cause: the production `ivfflat` embedding indexes were created on empty
tables, so their clusters were trained on nothing; at 100+ rows, approximate
search with the default `probes=1` silently dropped or emptied result sets.
Invisible at 3 skills, catastrophic at 120. Fixed in migration `003_hnsw.sql`
(HNSW needs no training data and builds incrementally): **12.5% → 85.0% top-1.**
This is precisely the class of scale bug the bench exists to expose before a
customer does.

Remaining misses are dominated by genuine topical near-duplicates — e.g. three
teams' merge-request-review processes all plausibly answer "can you review my
MR?". Distinguishing those needs metadata (owning team) or clarification, not a
better embedding.

## Method & caveats

- Skills drafted by `gpt-5.4-mini` via the production `draft-from-text` pipeline, then activated in an isolated `bench` schema; retrieval is the production `find_skill` pgvector cosine top-1 over `text-embedding-3-small`.
- Queries are synthetic (LLM) but generated from the raw source pages with anti-copy instructions — the standard synthetic-query eval caveat applies; a hand-written query set is the next hardening step.
- Handbook pages sometimes overlap topically; some "misses" are near-duplicates where multiple skills are defensible answers. See the results JSON for full per-query data.
