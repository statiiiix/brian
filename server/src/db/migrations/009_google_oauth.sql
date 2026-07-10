-- One-time OAuth state for Google Workspace connections.
-- The state value itself is never stored; only a SHA-256 hash is persisted.
-- It expires quickly and is marked used on callback to prevent replay.
create table if not exists oauth_states (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  provider        text not null,
  connector_types jsonb not null default '[]',
  state_hash      text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

alter table oauth_states enable row level security;
grant select, insert, update, delete on oauth_states to brian_app;
alter default privileges in schema public grant select, insert, update, delete on tables to brian_app;
drop policy if exists tenant_isolation on oauth_states;
create policy tenant_isolation on oauth_states
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create index if not exists oauth_states_expiry_idx on oauth_states (expires_at);
create index if not exists oauth_states_tenant_idx on oauth_states (tenant_id);
