-- Replace ivfflat embedding indexes with HNSW.
-- ivfflat trains its clusters from the rows present at CREATE INDEX time; ours
-- were built on empty tables, so at scale (100+ rows) approximate search with
-- the default ivfflat.probes=1 returned incomplete or EMPTY result sets
-- (discovered by Brian-bench: 28/120 queries got zero results). HNSW builds
-- incrementally, needs no training data, and keeps high recall as data grows.
-- HNSW build sizes its memory from relation pages (bloat included); Supabase's
-- 32MB default is too small. Session-scoped: applies to this connection only.
set maintenance_work_mem = '128MB';

drop index if exists skills_embedding_idx;
create index if not exists skills_embedding_hnsw_idx
  on skills using hnsw (embedding vector_cosine_ops);

drop index if exists context_entries_embedding_idx;
create index if not exists context_entries_embedding_hnsw_idx
  on context_entries using hnsw (embedding vector_cosine_ops);
