-- Multi-tenancy foundation (SupabaseIntegration.md §3): shared tables +
-- tenant_id, so every client company's skills/context/users are isolated by a
-- column instead of separate tables or schemas. Convergent/re-runnable like
-- 001-004.
--
-- Phase 1 is deliberately NON-BREAKING: tenant_id defaults to the founding
-- tenant, so pre-multitenancy inserts (repos + the existing test suite) keep
-- working before the guard and repos are made tenant-aware. RLS stays
-- decorative until phase 2 (needs the non-owner brian_app role).

-- The founding tenant has a FIXED id so it can serve as a column default
-- (defaults cannot be subqueries). Everything that predates multitenancy
-- belongs to it.
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  status      text not null default 'active',    -- active | suspended
  created_at  timestamptz not null default now()
);

insert into tenants (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Sameh', 'sameh')
on conflict (slug) do nothing;

-- Agent credentials: one or more per tenant, revocable independently. Only the
-- sha256 hash of the bearer is stored; the plaintext is shown once at creation.
create table if not exists api_tokens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  token_hash  text not null unique,              -- sha256 hex of the bearer token
  label       text not null,                     -- 'prod claude-code', 'codex laptop'
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists api_tokens_tenant_idx on api_tokens (tenant_id);

-- Add tenant_id to every tenant-owned table, defaulting to the founding tenant
-- so existing rows backfill and pre-tenant code keeps inserting successfully.
alter table skills           add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);
alter table skill_versions   add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);
alter table context_entries  add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);
alter table context_versions add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);
alter table executions       add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);
alter table interviews       add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);
alter table users            add column if not exists tenant_id uuid not null default '00000000-0000-0000-0000-000000000001' references tenants(id);

-- Tenant-scoped lookup indexes.
create index if not exists skills_tenant_idx           on skills (tenant_id);
create index if not exists skill_versions_tenant_idx   on skill_versions (tenant_id);
create index if not exists context_entries_tenant_idx  on context_entries (tenant_id);
create index if not exists context_versions_tenant_idx on context_versions (tenant_id);
create index if not exists executions_tenant_idx       on executions (tenant_id);
create index if not exists interviews_tenant_idx       on interviews (tenant_id);
create index if not exists users_tenant_idx            on users (tenant_id);

-- Uniqueness becomes per-tenant: drop the old global unique on users.email and
-- enforce (tenant_id, email) instead. A unique INDEX with `if not exists` keeps
-- this convergent (unlike `add constraint`, which has no if-not-exists form).
alter table users drop constraint if exists users_email_key;
create unique index if not exists users_tenant_email_idx on users (tenant_id, email);
