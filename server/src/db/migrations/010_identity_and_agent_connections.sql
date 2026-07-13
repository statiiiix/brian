-- Public identity, memberships, OAuth agent grants, and tenant-owned audit
-- state. This repository replays every migration, so all objects below are
-- convergent. Production runs in public; tests run with current_schema() =
-- test. Tests use a schema-local auth-user stand-in so a test migration never
-- installs triggers on, or inserts rows into, the real auth.users table.

create extension if not exists citext;
create extension if not exists pgcrypto;

do $$
declare
  s text := current_schema();
  auth_users text;
  citext_type text;
begin
  -- citext may live in extensions, public, or the isolated test schema, and
  -- none of those is guaranteed to be on the caller's search_path. Resolve
  -- the installed extension's actual schema instead of trusting the path.
  select format('%I.citext', n.nspname) into citext_type
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'citext';
  if citext_type is null then
    raise exception 'citext extension is required';
  end if;

  if s = 'public' then
    if to_regclass('auth.users') is null then
      raise exception 'auth.users is required for identity migration';
    end if;
    auth_users := 'auth.users';
  else
    execute format($sql$
      create table if not exists %I.brian_auth_users_test (
        id                 uuid primary key,
        email              %s not null unique,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        raw_app_meta_data  jsonb not null default '{}'::jsonb,
        created_at         timestamptz not null default now()
      )
    $sql$, s, citext_type);
    auth_users := format('%I.brian_auth_users_test', s);
  end if;

  execute format($sql$
    create table if not exists %I.tenant_memberships (
      id         uuid primary key default gen_random_uuid(),
      tenant_id  uuid not null references %I.tenants(id) on delete cascade,
      user_id    uuid not null references %s(id) on delete cascade,
      role       text not null check (role in ('owner', 'admin', 'expert', 'viewer')),
      status     text not null default 'active'
                 check (status in ('invited', 'active', 'suspended', 'removed')),
      is_default boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, user_id)
    )
  $sql$, s, s, auth_users);

  execute format($sql$
    create table if not exists %I.agent_connections (
      id               uuid primary key default gen_random_uuid(),
      tenant_id        uuid not null references %I.tenants(id) on delete cascade,
      user_id          uuid not null references %s(id) on delete cascade,
      oauth_client_id  text not null check (length(btrim(oauth_client_id)) between 1 and 512),
      client_name      text not null check (length(btrim(client_name)) between 1 and 200),
      display_name     text check (display_name is null or length(btrim(display_name)) between 1 and 200),
      client_uri       text,
      redirect_origins jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(redirect_origins) = 'array'),
      permissions      text[] not null default '{}'::text[]
                       check (permissions <@ array[
                         'skills:read', 'context:read', 'knowledge:write',
                         'executions:write', 'actions:execute'
                       ]::text[]),
      status           text not null default 'pending'
                       check (status in ('pending', 'active', 'denied', 'revoked')),
      approved_at      timestamptz,
      last_used_at     timestamptz,
      expires_at       timestamptz,
      revoked_at       timestamptz,
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now(),
      check (expires_at is null or expires_at > created_at),
      check (status <> 'active' or approved_at is not null),
      check (status <> 'revoked' or revoked_at is not null)
    )
  $sql$, s, s, auth_users);

  execute format($sql$
    create table if not exists %I.tenant_invitations (
      id          uuid primary key default gen_random_uuid(),
      tenant_id   uuid not null references %I.tenants(id) on delete cascade,
      email       %s not null,
      role        text not null check (role in ('owner', 'admin', 'expert', 'viewer')),
      token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
      invited_by  uuid references %s(id) on delete set null,
      expires_at  timestamptz not null,
      accepted_at timestamptz,
      revoked_at  timestamptz,
      created_at  timestamptz not null default now(),
      check (expires_at > created_at),
      check (accepted_at is null or revoked_at is null)
    )
  $sql$, s, s, citext_type, auth_users);

  -- Converge prerelease schemas: deleting an inviter must not make Supabase
  -- account deletion fail or invalidate the tenant's otherwise valid invite.
  execute format('alter table %I.tenant_invitations alter column invited_by drop not null', s);
  execute format(
    'alter table %I.tenant_invitations drop constraint if exists tenant_invitations_invited_by_fkey',
    s
  );
  execute format(
    'alter table %I.tenant_invitations add constraint tenant_invitations_invited_by_fkey foreign key (invited_by) references %s(id) on delete set null',
    s, auth_users
  );

  execute format($sql$
    create table if not exists %I.security_audit_events (
      id            bigint generated always as identity primary key,
      tenant_id     uuid references %I.tenants(id) on delete set null,
      actor_user_id uuid references %s(id) on delete set null,
      connection_id uuid,
      event_type    text not null check (length(btrim(event_type)) between 1 and 120),
      target_type   text,
      target_id     text,
      metadata      jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(metadata) = 'object'),
      request_id    text,
      created_at    timestamptz not null default now()
    )
  $sql$, s, s, auth_users);

  -- Converge prerelease audit tables and retain their immutable history when
  -- an agent connection is later deleted.
  execute format(
    'alter table %I.security_audit_events add column if not exists connection_id uuid',
    s
  );
  if not exists (
    select 1 from pg_constraint
     where conname = 'security_audit_events_connection_fk'
       and conrelid = format('%I.security_audit_events', s)::regclass
  ) then
    execute format(
      'alter table %I.security_audit_events add constraint security_audit_events_connection_fk foreign key (connection_id) references %I.agent_connections(id) on delete set null',
      s, s
    );
  end if;

  execute format($sql$
    create table if not exists %I.onboarding_state (
      tenant_id       uuid primary key references %I.tenants(id) on delete cascade,
      current_step    smallint not null default 1 check (current_step between 1 and 5),
      completed_steps text[] not null default '{}'::text[],
      completed       boolean not null default false,
      first_mcp_call_at timestamptz,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    )
  $sql$, s, s);

  -- Existing executions gain an immutable principal trail. ON DELETE SET NULL
  -- retains execution history when a user or connection is deleted.
  execute format('alter table %I.executions add column if not exists actor_user_id uuid', s);
  execute format('alter table %I.executions add column if not exists connection_id uuid', s);
  if not exists (
    select 1 from pg_constraint
     where conname = 'executions_actor_user_fk'
       and conrelid = format('%I.executions', s)::regclass
  ) then
    execute format(
      'alter table %I.executions add constraint executions_actor_user_fk foreign key (actor_user_id) references %s(id) on delete set null',
      s, auth_users
    );
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'executions_connection_fk'
       and conrelid = format('%I.executions', s)::regclass
  ) then
    execute format(
      'alter table %I.executions add constraint executions_connection_fk foreign key (connection_id) references %I.agent_connections(id) on delete set null',
      s, s
    );
  end if;
end $$;

alter table agent_connections add column if not exists display_name text;
alter table onboarding_state add column if not exists first_mcp_call_at timestamptz;

-- Converge prerelease databases that briefly used symbolic text step names.
do $$
declare step_type text;
begin
  select data_type into step_type
    from information_schema.columns
   where table_schema = current_schema()
     and table_name = 'onboarding_state'
     and column_name = 'current_step';
  if step_type not in ('smallint', 'integer') then
    alter table onboarding_state alter column current_step drop default;
    execute $sql$
      alter table onboarding_state alter column current_step type smallint using (
        case current_step::text
          when 'company_created' then 1
          when 'company' then 1
          when 'skill' then 2
          when 'sources' then 3
          when 'agent' then 4
          when 'verify' then 5
          else 1
        end
      )
    $sql$;
    alter table onboarding_state alter column current_step set default 1;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'onboarding_state_current_step_check'
       and conrelid = 'onboarding_state'::regclass
  ) then
    alter table onboarding_state
      add constraint onboarding_state_current_step_check check (current_step between 1 and 5);
  end if;
end $$;

-- Close a pre-existing isolation omission: skill_links is tenant-owned too.
-- Backfill from the referenced skills rather than assigning every historical
-- link to the founding tenant, and fail closed if a historical link spans two
-- tenants. Composite foreign keys then make that agreement permanent.
alter table skill_links add column if not exists tenant_id uuid;

do $$
begin
  if exists (
    select 1
      from skill_links l
      join skills source_skill on source_skill.id = l.from_skill_id
      join skills target_skill on target_skill.id = l.to_skill_id
     where source_skill.tenant_id is distinct from target_skill.tenant_id
  ) then
    raise exception 'cannot migrate cross-tenant skill link'
      using errcode = '23514';
  end if;
end $$;

update skill_links l
   set tenant_id = source_skill.tenant_id
  from skills source_skill
 where source_skill.id = l.from_skill_id
   and l.tenant_id is distinct from source_skill.tenant_id;

alter table skill_links alter column tenant_id drop default;
alter table skill_links alter column tenant_id set not null;

create unique index if not exists skills_tenant_id_id_idx
  on skills (tenant_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'skill_links_tenant_id_fkey'
       and conrelid = 'skill_links'::regclass
  ) then
    alter table skill_links
      add constraint skill_links_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'skill_links_from_skill_tenant_fkey'
       and conrelid = 'skill_links'::regclass
  ) then
    alter table skill_links
      add constraint skill_links_from_skill_tenant_fkey
      foreign key (tenant_id, from_skill_id)
      references skills (tenant_id, id) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'skill_links_to_skill_tenant_fkey'
       and conrelid = 'skill_links'::regclass
  ) then
    alter table skill_links
      add constraint skill_links_to_skill_tenant_fkey
      foreign key (tenant_id, to_skill_id)
      references skills (tenant_id, id) not valid;
  end if;
end $$;

alter table skill_links validate constraint skill_links_tenant_id_fkey;
alter table skill_links validate constraint skill_links_from_skill_tenant_fkey;
alter table skill_links validate constraint skill_links_to_skill_tenant_fkey;
alter table skill_links drop constraint if exists skill_links_from_skill_id_fkey;
alter table skill_links drop constraint if exists skill_links_to_skill_id_fkey;
alter table skill_links enable row level security;

alter table tenants add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tenants_status_check'
       and conrelid = 'tenants'::regclass
  ) then
    alter table tenants
      add constraint tenants_status_check check (status in ('active', 'suspended'));
  end if;
end $$;

create index if not exists tenant_memberships_user_status_idx
  on tenant_memberships (user_id, status);
create index if not exists tenant_memberships_tenant_status_idx
  on tenant_memberships (tenant_id, status);
create unique index if not exists tenant_memberships_one_active_default_idx
  on tenant_memberships (user_id)
  where is_default and status = 'active';

create index if not exists agent_connections_tenant_status_idx
  on agent_connections (tenant_id, status);
create index if not exists agent_connections_user_client_idx
  on agent_connections (user_id, oauth_client_id);
-- Phase-0 decision: the access-token hook currently receives user_id and
-- client_id, but no selected Brian tenant/grant identifier. Keep issuance
-- unambiguous by allowing one open grant per user/client across all tenants.
create unique index if not exists agent_connections_one_open_grant_per_user_client_idx
  on agent_connections (user_id, oauth_client_id)
  where status in ('pending', 'active');

create index if not exists tenant_invitations_tenant_email_idx
  on tenant_invitations (tenant_id, email);
create index if not exists tenant_invitations_invited_by_idx
  on tenant_invitations (invited_by);
create unique index if not exists tenant_invitations_one_open_email_idx
  on tenant_invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;
create index if not exists security_audit_events_tenant_created_idx
  on security_audit_events (tenant_id, created_at desc);
create index if not exists security_audit_events_actor_created_idx
  on security_audit_events (actor_user_id, created_at desc);
create index if not exists security_audit_events_connection_created_idx
  on security_audit_events (connection_id, created_at desc);
create index if not exists executions_actor_user_idx on executions (actor_user_id);
create index if not exists executions_connection_idx on executions (connection_id);
create index if not exists skill_links_tenant_idx on skill_links (tenant_id);
create index if not exists skill_links_tenant_from_skill_idx
  on skill_links (tenant_id, from_skill_id);
create index if not exists skill_links_tenant_to_skill_idx
  on skill_links (tenant_id, to_skill_id);

-- One generic timestamp trigger, schema-qualified and with a fixed search path.
do $$
declare s text := current_schema();
declare t text;
begin
  execute format($fn$
    create or replace function %I.brian_touch_updated_at()
    returns trigger
    language plpgsql
    security invoker
    set search_path = pg_catalog
    as $body$
    begin
      new.updated_at := now();
      return new;
    end
    $body$
  $fn$, s);
  execute format('revoke execute on function %I.brian_touch_updated_at() from public', s);

  foreach t in array array['tenants', 'tenant_memberships', 'agent_connections', 'onboarding_state'] loop
    execute format('drop trigger if exists brian_touch_updated_at on %I.%I', s, t);
    execute format(
      'create trigger brian_touch_updated_at before update on %I.%I for each row execute function %I.brian_touch_updated_at()',
      s, t, s
    );
  end loop;
end $$;

-- Ownership is a tenant invariant, not only an API check. Lock the tenant row
-- before an active owner can be lost so concurrent removals serialize, then use
-- a deferred constraint trigger so an ownership transfer may complete anywhere
-- within the same transaction. A cascading membership delete caused by deleting
-- the tenant is allowed because the tenant row no longer exists at check time.
do $$
declare s text := current_schema();
begin
  execute format($fn$
    create or replace function %I.brian_lock_tenant_for_owner_loss()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $body$
    declare v_owner_lost boolean := false;
    begin
      if old.role = 'owner' and old.status = 'active' then
        if tg_op = 'DELETE' then
          v_owner_lost := true;
        elsif old.tenant_id is distinct from new.tenant_id
           or new.role is distinct from 'owner'
           or new.status is distinct from 'active' then
          v_owner_lost := true;
        end if;
      end if;

      if v_owner_lost then
        perform 1 from %I.tenants where id = old.tenant_id for update;
      end if;

      if tg_op = 'DELETE' then return old; end if;
      return new;
    end
    $body$
  $fn$, s, s);

  execute format($fn$
    create or replace function %I.brian_require_active_tenant_owner()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $body$
    declare v_owner_lost boolean := false;
    begin
      if old.role = 'owner' and old.status = 'active' then
        if tg_op = 'DELETE' then
          v_owner_lost := true;
        elsif old.tenant_id is distinct from new.tenant_id
           or new.role is distinct from 'owner'
           or new.status is distinct from 'active' then
          v_owner_lost := true;
        end if;
      end if;
      if not v_owner_lost then return null; end if;

      -- Reacquire/retain the same serialization lock and permit a tenant delete.
      perform 1 from %I.tenants where id = old.tenant_id for update;
      if not found then return null; end if;

      if not exists (
        select 1 from %I.tenant_memberships
         where tenant_id = old.tenant_id
           and role = 'owner' and status = 'active'
      ) then
        raise exception 'tenant must retain at least one active owner'
          using errcode = '23514';
      end if;
      return null;
    end
    $body$
  $fn$, s, s, s);

  execute format('revoke all on function %I.brian_lock_tenant_for_owner_loss() from public', s);
  execute format('revoke all on function %I.brian_require_active_tenant_owner() from public', s);
  execute format('revoke all on function %I.brian_lock_tenant_for_owner_loss() from brian_app', s);
  execute format('revoke all on function %I.brian_require_active_tenant_owner() from brian_app', s);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %I.brian_lock_tenant_for_owner_loss() from anon', s);
    execute format('revoke all on function %I.brian_require_active_tenant_owner() from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %I.brian_lock_tenant_for_owner_loss() from authenticated', s);
    execute format('revoke all on function %I.brian_require_active_tenant_owner() from authenticated', s);
  end if;

  execute format('drop trigger if exists brian_lock_owner_delete on %I.tenant_memberships', s);
  execute format('drop trigger if exists brian_lock_owner_update on %I.tenant_memberships', s);
  execute format('drop trigger if exists brian_require_owner_after_delete on %I.tenant_memberships', s);
  execute format('drop trigger if exists brian_require_owner_after_update on %I.tenant_memberships', s);
  execute format(
    'create trigger brian_lock_owner_delete before delete on %I.tenant_memberships for each row execute function %I.brian_lock_tenant_for_owner_loss()',
    s, s
  );
  execute format(
    'create trigger brian_lock_owner_update before update of tenant_id, role, status on %I.tenant_memberships for each row execute function %I.brian_lock_tenant_for_owner_loss()',
    s, s
  );
  execute format(
    'create constraint trigger brian_require_owner_after_delete after delete on %I.tenant_memberships deferrable initially deferred for each row execute function %I.brian_require_active_tenant_owner()',
    s, s
  );
  execute format(
    'create constraint trigger brian_require_owner_after_update after update of tenant_id, role, status on %I.tenant_memberships deferrable initially deferred for each row execute function %I.brian_require_active_tenant_owner()',
    s, s
  );
end $$;

-- Tenant isolation. Policies include WITH CHECK so tenant ownership cannot be
-- reassigned during UPDATE. tenants uses its id as the tenant key.
do $$
declare s text := current_schema();
declare t text;
begin
  execute format('alter table %I.tenants enable row level security', s);
  execute format('drop policy if exists tenant_isolation on %I.tenants', s);
  execute format($policy$
    create policy tenant_isolation on %I.tenants
      using (id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
      with check (id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
  $policy$, s);

  foreach t in array array[
    'tenant_memberships', 'agent_connections', 'tenant_invitations',
    'security_audit_events', 'onboarding_state', 'skill_links'
  ] loop
    execute format('alter table %I.%I enable row level security', s, t);
    execute format('drop policy if exists tenant_isolation on %I.%I', s, t);
    execute format($policy$
      create policy tenant_isolation on %I.%I
        using (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
        with check (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
    $policy$, s, t);
  end loop;
end $$;

-- Explicit grants keep this migration correct even when 007's default
-- privileges were installed by a different migration owner. Browser roles get
-- no direct Data API access; Brian's API remains the authorization boundary.
do $$
declare s text := current_schema();
declare t text;
declare r text;
begin
  foreach t in array array[
    'tenant_memberships', 'agent_connections', 'tenant_invitations',
    'security_audit_events', 'onboarding_state', 'skill_links'
  ] loop
    if t = 'security_audit_events' then
      -- Security audit history is append/read-only for the runtime role. This
      -- also removes broad grants inherited from migrations 007/009.
      execute format('revoke all on table %I.%I from brian_app', s, t);
      execute format('grant select, insert on table %I.%I to brian_app', s, t);
    else
      execute format('grant select, insert, update, delete on table %I.%I to brian_app', s, t);
    end if;
    execute format('revoke all on table %I.%I from public', s, t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table %I.%I from %I', s, t, r);
      end if;
    end loop;
  end loop;
  execute format(
    'grant usage, select on sequence %I.security_audit_events_id_seq to brian_app',
    s
  );
end $$;
