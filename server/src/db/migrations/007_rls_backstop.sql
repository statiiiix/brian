-- RLS as a real backstop (SupabaseIntegration.md §7, phase 2). The API is on
-- the public internet (Supabase Edge Function), so database-level isolation
-- stops being optional: the app connects as the non-owner brian_app role and
-- every tenant-owned table gets a tenant_isolation policy keyed to the
-- transaction-scoped app.tenant_id setting (SET LOCAL by the tenant layer).
-- Tenant scoping is now enforced twice: explicitly in repo SQL (correctness +
-- index use) and by RLS (a forgotten WHERE clause is a bug, not a breach).
--
-- Convergent/re-runnable like 001-006, and schema-relative: grants/policies
-- apply to whatever schema the migration runs in (public live, test in CI).
-- The role has NO password here (this file is in git): the login credential
-- is set out-of-band (alter role brian_app login password '…'). Migrations
-- keep running as the postgres owner, which bypasses these policies.

do $$ begin
  if not exists (select from pg_roles where rolname = 'brian_app') then
    create role brian_app nologin;
  end if;
end $$;

do $$
declare s text := current_schema();
begin
  execute format('grant usage on schema %I to brian_app', s);
  execute format('grant select, insert, update, delete on all tables in schema %I to brian_app', s);
  execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to brian_app', s);
end $$;

-- Ensure RLS is on everywhere (001-006 already enable most of these; keep it
-- convergent and complete here).
alter table tenants          enable row level security;
alter table api_tokens       enable row level security;
alter table skills           enable row level security;
alter table skill_versions   enable row level security;
alter table context_entries  enable row level security;
alter table context_versions enable row level security;
alter table executions       enable row level security;
alter table users            enable row level security;
alter table interviews       enable row level security;
alter table connectors       enable row level security;
alter table evidence         enable row level security;

-- The isolation predicate: the row's tenant must equal the request tenant
-- bound by SET LOCAL app.tenant_id. Unset/empty setting -> null -> no rows.
do $$
declare t text;
begin
  foreach t in array array[
    'skills','skill_versions','context_entries','context_versions',
    'executions','users','interviews','connectors','evidence','api_tokens'
  ] loop
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  end loop;
end $$;

-- Pre-tenant lookups: the guard resolves bearer-hash -> tenant (api_tokens
-- join tenants) BEFORE any tenant context exists, so these two tables allow
-- SELECT without app.tenant_id. api_tokens stores only sha256 hashes; tenants
-- holds name/slug/status. Writes stay governed by tenant_isolation (and the
-- owner for admin operations).
drop policy if exists pre_tenant_lookup on api_tokens;
create policy pre_tenant_lookup on api_tokens for select using (true);
drop policy if exists pre_tenant_lookup on tenants;
create policy pre_tenant_lookup on tenants for select using (true);
