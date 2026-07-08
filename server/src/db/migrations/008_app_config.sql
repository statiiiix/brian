-- Owner-only runtime config for the hosted deployment (src/config/secrets.ts).
-- The Supabase Edge Function connects with the platform-provided owner
-- credential and reads its secrets (OpenAI key, static bearer, JWT secret)
-- from here, making the hosted backend self-sufficient without dashboard
-- secret management. RLS is enabled with NO policies: the owner bypasses RLS,
-- everyone else (brian_app, anon, authenticated) is denied.
create table if not exists app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
revoke all on app_config from brian_app;
