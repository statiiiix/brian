-- Server-side enforcement of hard rules (goal 4.1).
--
-- Until now a skill's hard_rules were English text handed to a model, so
-- "never refund more than $200" was a suggestion: enforcement depended on the
-- agent choosing to comply. These three changes move the decision to the
-- server, where it is deterministic and auditable:
--
--   skills.policy       compiled, machine-checkable form of the hard rules
--   agent_session_state what the agent consulted and established this session
--                       (the MCP transport is stateless, so it cannot be memory)
--   policy_decisions    every allow/deny, with the rule that decided it
--
-- Convergent and schema-relative like 001-022.

alter table skills
  add column if not exists policy jsonb not null
  default '{"constraints":[],"advisory":[],"compiled_at":null,"pending":false}'::jsonb;

-- Backfill: a skill that already carries hard rules has never been compiled, so
-- it must NOT read as "compiled, zero constraints" — that would leave exactly
-- the rule-bearing skills silently unenforced. Mark them pending so the gate
-- fails closed until someone compiles them (POST /api/skills/:id/compile-policy
-- or any save). Skills with no rules have nothing to enforce and stay open.
-- Migrations are re-run in full on every deploy, so this must only ever touch
-- skills that have NEVER been compiled. Without the compiled_at guard it would
-- reset real compiled policies to pending on each run and quietly disable
-- enforcement after every deploy.
update skills
   set policy = jsonb_build_object(
         'constraints', '[]'::jsonb,
         'advisory', '[]'::jsonb,
         'compiled_at', null,
         'pending', true)
 where (coalesce(jsonb_array_length(hard_rules), 0) > 0
        or coalesce(jsonb_array_length(guardrails), 0) > 0)
   and coalesce(policy->>'compiled_at', '') = ''
   and coalesce((policy->>'pending')::boolean, false) = false;

do $$
declare s text := current_schema();
begin
  -- Consultations ('skill') and established facts ('fact') for one agent
  -- session. Short-lived: pruned by retention, not kept as history.
  execute format($ddl$
    create table if not exists %I.agent_session_state (
      id          uuid primary key default gen_random_uuid(),
      tenant_id   uuid not null references %I.tenants(id) on delete cascade,
      session_key text not null,
      kind        text not null check (kind in ('skill', 'fact')),
      ref         text not null,
      value       jsonb not null default '{}'::jsonb,
      created_at  timestamptz not null default now(),
      unique (tenant_id, session_key, kind, ref)
    )
  $ddl$, s, s);

  execute format(
    'create index if not exists agent_session_state_lookup_idx
       on %I.agent_session_state (tenant_id, session_key, kind, created_at desc)', s);

  -- The audit trail. Arguments are stored because a denial is only defensible
  -- if you can show what was attempted; connector credentials never pass
  -- through here, and privacy deletion cascades via tenant_id.
  execute format($ddl$
    create table if not exists %I.policy_decisions (
      id            uuid primary key default gen_random_uuid(),
      tenant_id     uuid not null references %I.tenants(id) on delete cascade,
      session_key   text,
      connection_id uuid,
      actor_user_id uuid,
      tool          text not null,
      decision      text not null check (decision in ('allow', 'deny')),
      args          jsonb not null default '{}'::jsonb,
      skill_ids     jsonb not null default '[]'::jsonb,
      violations    jsonb not null default '[]'::jsonb,
      evaluated     integer not null default 0,
      created_at    timestamptz not null default now()
    )
  $ddl$, s, s);

  execute format(
    'create index if not exists policy_decisions_tenant_idx
       on %I.policy_decisions (tenant_id, created_at desc)', s);
  execute format(
    'create index if not exists policy_decisions_denied_idx
       on %I.policy_decisions (tenant_id, decision, created_at desc)', s);
end $$;

-- Same backstop as every other tenant-owned table (007): the app role only
-- ever sees rows for the tenant bound to app.tenant_id.
alter table agent_session_state enable row level security;
alter table policy_decisions    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agent_session_state', 'policy_decisions'] loop
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  end loop;
end $$;

do $$
declare s text := current_schema();
begin
  if exists (select from pg_roles where rolname = 'brian_app') then
    execute format(
      'grant select, insert, update, delete on %I.agent_session_state to brian_app', s);
    execute format(
      'grant select, insert, update, delete on %I.policy_decisions to brian_app', s);
  end if;
end $$;
