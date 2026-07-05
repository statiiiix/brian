-- Connectors (capture from comms) — per-tenant credentials/cursors + extracted
-- evidence. Tenant-scoped + RLS-enabled like 005 (owner backend bypasses RLS;
-- policies land with Phase 2). Convergent/re-runnable.

create table if not exists connectors (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) default '00000000-0000-0000-0000-000000000001',
  type           text not null,                 -- 'gmail' | 'slack'
  status         text not null default 'disabled', -- disabled | connected | error
  credentials    jsonb not null default '{}',   -- refresh_token / bot_token (secret)
  cursor         jsonb not null default '{}',   -- gmail: {historyId}; slack: {channelTs:{...}}
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, type)                       -- one connector per source per tenant
);
alter table connectors enable row level security;
create index if not exists connectors_tenant_idx on connectors (tenant_id);

create table if not exists evidence (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) default '00000000-0000-0000-0000-000000000001',
  connector_id     uuid not null references connectors(id),
  source_ref       jsonb not null,              -- {thread_id, message_ids[], permalink}
  kind             text not null,               -- 'skill_evidence' | 'context_evidence'
  summary          text not null,
  raw_snippet      text,
  confidence       real not null default 0,
  embedding        vector(1536),
  promoted_to_kind text,                         -- 'skill' | 'context' once drafted
  promoted_to_id   uuid,
  created_at       timestamptz not null default now()
);
alter table evidence enable row level security;
create index if not exists evidence_tenant_idx on evidence (tenant_id);
-- Dedupe re-syncs of the same thread (per connector per tenant). Expression
-- index on the stable thread_id rather than whole-jsonb equality.
create unique index if not exists evidence_thread_uk
  on evidence (tenant_id, connector_id, (source_ref->>'thread_id'));
