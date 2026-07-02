create extension if not exists vector;

create table if not exists skills (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  trigger           text not null,
  inputs            jsonb not null default '[]',
  procedure         text not null,
  hard_rules        jsonb not null default '[]',
  tools             jsonb not null default '[]',
  guardrails        jsonb not null default '[]',
  escalation_target text,
  examples          jsonb not null default '[]',
  owner             text,
  status            text not null default 'draft',
  version           int  not null default 1,
  last_reviewed_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  embedding         vector(1536)
);

-- embedding index: see 003_hnsw.sql (ivfflat replaced by hnsw; keeping the old
-- create here would rebuild a dropped index on every run — these files re-run).

create table if not exists skill_versions (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references skills(id),
  version     int not null,
  snapshot    jsonb not null,
  changed_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists skill_links (
  id            uuid primary key default gen_random_uuid(),
  from_skill_id uuid not null references skills(id),
  to_skill_id   uuid not null references skills(id),
  relation      text not null
);

create table if not exists executions (
  id            uuid primary key default gen_random_uuid(),
  skill_id      uuid references skills(id),
  skill_version int,
  task_input    jsonb,
  actions_taken jsonb,
  outcome       text,
  human_override jsonb,
  created_at    timestamptz not null default now()
);
