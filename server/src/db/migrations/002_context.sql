create table if not exists context_entries (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  summary     text,
  tags        jsonb not null default '[]',
  source      text,
  status      text not null default 'active',
  owner       text,
  version     int  not null default 1,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- embedding index: see 003_hnsw.sql.
-- RLS on (like every other owned table). No policy yet: the backend connects as
-- the owner (bypasses RLS), so this only denies the exposed anon/authenticated
-- PostgREST roles. Idempotent / convergent.
alter table context_entries enable row level security;

create table if not exists context_versions (
  id          uuid primary key default gen_random_uuid(),
  context_id  uuid not null references context_entries(id),
  version     int not null,
  snapshot    jsonb not null,
  changed_by  text,
  created_at  timestamptz not null default now()
);
alter table context_versions enable row level security;
