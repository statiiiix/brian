-- Normalized sources and evidence for adaptive, source-grounded interviews.
-- Existing interviews.source_context remains as a compatibility snapshot.

create table if not exists interview_sources (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id),
  interview_id    uuid not null references interviews(id) on delete cascade,
  kind            text not null check (kind in ('connector', 'upload', 'web')),
  title           text not null,
  source_type     text not null,
  url             text,
  status          text not null default 'reading' check (status in ('reading', 'ready', 'failed')),
  extracted_text  text,
  idempotency_key text not null,
  added_at        timestamptz not null default now(),
  retrieved_at    timestamptz,
  error_code      text,
  unique (tenant_id, interview_id, idempotency_key)
);

create index if not exists interview_sources_tenant_interview_idx
  on interview_sources (tenant_id, interview_id, added_at);
alter table interview_sources enable row level security;

create table if not exists interview_evidence (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id),
  interview_id uuid not null references interviews(id) on delete cascade,
  source_id    uuid references interview_sources(id) on delete cascade,
  origin       text not null check (origin in ('company', 'expert', 'web')),
  component    text not null,
  statement    text not null,
  citation     jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists interview_evidence_tenant_interview_idx
  on interview_evidence (tenant_id, interview_id, created_at);
alter table interview_evidence enable row level security;

alter table interviews add column if not exists assumptions jsonb not null default '[]'::jsonb;
alter table interviews add column if not exists warnings jsonb not null default '[]'::jsonb;

drop policy if exists tenant_isolation on interview_sources;
create policy tenant_isolation on interview_sources
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists tenant_isolation on interview_evidence;
create policy tenant_isolation on interview_evidence
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

do $$
begin
  if exists (select from pg_roles where rolname = 'brian_app') then
    grant select, insert, update, delete on interview_sources, interview_evidence to brian_app;
  end if;
end $$;
