-- Owner-only configuration and migration-era secret fallback
-- (src/config/secrets.ts). The production application connects as brian_app
-- and receives secrets from its deployment environment; it cannot read this
-- table. Security-definer database triggers may read operational flags such as
-- PUBLIC_SIGNUP_ENABLED. RLS has NO broad policies: only the owner bypasses it.
create table if not exists app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
revoke all on app_config from brian_app;
