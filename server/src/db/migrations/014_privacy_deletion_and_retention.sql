-- Privacy lifecycle controls for account/company deletion and retention.
--
-- Runtime callers never receive broad cross-tenant access. The three narrow
-- SECURITY DEFINER entry points below bind their supplied user id to
-- transaction-local app.user_id (set only after JWT verification), enforce
-- current membership/ownership, and return only non-secret request metadata.

do $$
declare
  s text := current_schema();
  stale_check record;
  auth_users text := case
    when current_schema() = 'public' then 'auth.users'
    else format('%I.brian_auth_users_test', current_schema())
  end;
begin
  execute format($ddl$
    create table if not exists %I.data_deletion_requests (
      id                   uuid primary key default gen_random_uuid(),
      tenant_id            uuid references %I.tenants(id) on delete set null,
      requested_by_user_id uuid references %s(id) on delete set null,
      target_user_id       uuid references %s(id) on delete set null,
      scope                text not null check (scope in ('account', 'company')),
      status               text not null default 'pending'
                           check (status in ('pending', 'processing', 'cancelled', 'completed', 'failed')),
      grace_period_days    smallint not null default 30
                           check (grace_period_days between 1 and 365),
      scheduled_for        timestamptz not null,
      cancelled_at         timestamptz,
      completed_at         timestamptz,
      attempt_count        integer not null default 0 check (attempt_count >= 0),
      last_failure_code    text check (
        last_failure_code is null
        or last_failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
      ),
      created_at           timestamptz not null default now(),
      updated_at           timestamptz not null default now(),
      check (scheduled_for >= created_at),
      -- FK "on delete set null" actions run as separate statements per
      -- constraint, so while an auth user is being deleted exactly one of
      -- (requested_by, target) is transiently null. The check must tolerate
      -- that or it aborts the account deletion itself; strict target=requester
      -- equality is enforced by request_data_deletion at insert time.
      constraint data_deletion_requests_actor_scope_check check (
        (scope = 'account'
          and (requested_by_user_id is null
            or target_user_id is null
            or target_user_id = requested_by_user_id))
        or (scope = 'company' and target_user_id is null)
      ),
      check (status <> 'cancelled' or cancelled_at is not null),
      check (status <> 'completed' or completed_at is not null)
    )
  $ddl$, s, s, auth_users, auth_users);

  -- Converge prerelease schemas that still carry the strict anonymous
  -- actor/scope check (it aborted real auth-user deletion mid-SET NULL).
  for stale_check in
    select conname
      from pg_constraint
     where conrelid = format('%I.data_deletion_requests', s)::regclass
       and contype = 'c'
       and conname <> 'data_deletion_requests_actor_scope_check'
       and pg_get_constraintdef(oid) like '%requested_by_user_id%'
  loop
    execute format(
      'alter table %I.data_deletion_requests drop constraint %I',
      s, stale_check.conname
    );
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = format('%I.data_deletion_requests', s)::regclass
       and conname = 'data_deletion_requests_actor_scope_check'
  ) then
    execute format($sql$
      alter table %I.data_deletion_requests
        add constraint data_deletion_requests_actor_scope_check check (
          (scope = 'account'
            and (requested_by_user_id is null
              or target_user_id is null
              or target_user_id = requested_by_user_id))
          or (scope = 'company' and target_user_id is null)
        )
    $sql$, s);
  end if;

  -- Attribution is intentionally nullable. Imported/bootstrap legacy tokens
  -- are tenant-owned and must not be falsely attributed to a human. Tokens
  -- issued while a verified human principal is in context record that user.
  execute format(
    'alter table %I.api_tokens add column if not exists created_by_user_id uuid',
    s
  );
  if not exists (
    select 1 from pg_constraint
     where conname = 'api_tokens_created_by_user_fk'
       and conrelid = format('%I.api_tokens', s)::regclass
  ) then
    execute format(
      'alter table %I.api_tokens add constraint api_tokens_created_by_user_fk foreign key (created_by_user_id) references %s(id) on delete set null',
      s, auth_users
    );
  end if;
end $$;

-- A user keeps dashboard access during the account-deletion grace period so
-- they can inspect/cancel the request, but must not mint replacement agent
-- credentials after the scheduling transaction revoked the existing ones.
-- Trigger enforcement closes races across every API/worker code path.
do $$
declare s text := current_schema();
begin
  execute format($function$
    create or replace function %I.brian_block_agent_grant_during_account_deletion()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, %I
    as $body$
    begin
      if new.status in ('pending', 'active') then
        -- Scheduling takes the same transaction-scoped key before inserting the
        -- request and revoking existing credentials. Whichever side arrives
        -- second waits, then observes the first side's committed lifecycle state.
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended('brian:account-deletion:' || new.user_id::text, 0)
        );
        if exists (
          select 1 from %I.data_deletion_requests request
           where request.scope = 'account'
             and request.target_user_id = new.user_id
             and request.status in ('pending', 'processing')
        ) then
          raise exception 'account deletion is pending'
            using errcode = '55000', constraint = 'account_deletion_pending';
        end if;
      end if;
      return new;
    end
    $body$
  $function$, s, s, s);

  execute format($function$
    create or replace function %I.brian_block_legacy_token_during_account_deletion()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, %I
    as $body$
    begin
      if new.created_by_user_id is not null and new.revoked_at is null then
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            'brian:account-deletion:' || new.created_by_user_id::text, 0
          )
        );
        if exists (
          select 1 from %I.data_deletion_requests request
           where request.scope = 'account'
             and request.target_user_id = new.created_by_user_id
             and request.status in ('pending', 'processing')
        ) then
          raise exception 'account deletion is pending'
            using errcode = '55000', constraint = 'account_deletion_pending';
        end if;
      end if;
      return new;
    end
    $body$
  $function$, s, s, s);

  execute format($function$
    create or replace function %I.brian_guard_connector_during_company_deletion()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, %I
    as $body$
    begin
      -- The deletion scheduler itself must be able to converge a connector to
      -- the erased terminal shape while it holds the tenant lifecycle lock.
      if new.status = 'disabled'
         and coalesce(new.credentials, '{}'::jsonb) = '{}'::jsonb
         and coalesce(new.cursor, '{}'::jsonb) = '{}'::jsonb then
        return new;
      end if;

      -- Company scheduling locks this row FOR UPDATE before it erases secrets
      -- and suspends the tenant. A competing connector write either finishes
      -- first and is then erased, or waits and fails after suspension commits.
      perform 1
        from %I.tenants tenant
       where tenant.id = new.tenant_id
         and tenant.status = 'active'
       for share;
      if not found then
        raise exception 'company deletion is pending'
          using errcode = '55000', constraint = 'company_deletion_pending';
      end if;
      return new;
    end
    $body$
  $function$, s, s, s);

  execute format('drop trigger if exists brian_block_deleted_user_grant on %I.agent_connections', s);
  execute format(
    'create trigger brian_block_deleted_user_grant before insert or update of status,user_id on %I.agent_connections for each row execute function %I.brian_block_agent_grant_during_account_deletion()',
    s, s
  );
  execute format('drop trigger if exists brian_block_deleted_user_token on %I.api_tokens', s);
  execute format(
    'create trigger brian_block_deleted_user_token before insert or update of created_by_user_id,revoked_at on %I.api_tokens for each row execute function %I.brian_block_legacy_token_during_account_deletion()',
    s, s
  );
  execute format('drop trigger if exists brian_guard_deleting_company_connector on %I.connectors', s);
  execute format(
    'create trigger brian_guard_deleting_company_connector before insert or update of tenant_id,status,credentials,cursor on %I.connectors for each row execute function %I.brian_guard_connector_during_company_deletion()',
    s, s
  );

  execute format(
    'revoke all on function %I.brian_block_agent_grant_during_account_deletion() from public', s
  );
  execute format(
    'revoke all on function %I.brian_block_legacy_token_during_account_deletion() from public', s
  );
  execute format(
    'revoke all on function %I.brian_block_agent_grant_during_account_deletion() from brian_app', s
  );
  execute format(
    'revoke all on function %I.brian_block_legacy_token_during_account_deletion() from brian_app', s
  );
  execute format(
    'revoke all on function %I.brian_guard_connector_during_company_deletion() from public', s
  );
  execute format(
    'revoke all on function %I.brian_guard_connector_during_company_deletion() from brian_app', s
  );
  -- Supabase default privileges grant EXECUTE on new public-schema functions
  -- directly to anon/authenticated; revoke those direct grants as well.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %I.brian_block_agent_grant_during_account_deletion() from anon', s);
    execute format('revoke all on function %I.brian_block_legacy_token_during_account_deletion() from anon', s);
    execute format('revoke all on function %I.brian_guard_connector_during_company_deletion() from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %I.brian_block_agent_grant_during_account_deletion() from authenticated', s);
    execute format('revoke all on function %I.brian_block_legacy_token_during_account_deletion() from authenticated', s);
    execute format('revoke all on function %I.brian_guard_connector_during_company_deletion() from authenticated', s);
  end if;
end $$;

-- Connector callbacks are unauthenticated after redirect, so the one-time
-- state resolver is also a company-lifecycle boundary. It first resolves the
-- opaque hash, then takes a shared tenant lock. Company scheduling takes the
-- conflicting UPDATE lock, making callback consumption and suspension ordered.
do $$
declare s text := current_schema();
begin
  execute format($function$
    create or replace function %I.consume_oauth_state(p_state_hash text)
    returns table (
      tenant_id uuid,
      provider text,
      connector_types jsonb
    )
    language plpgsql
    volatile
    security definer
    set search_path = pg_catalog, %I
    as $body$
    declare
      v_state_id uuid;
      v_tenant_id uuid;
    begin
      if p_state_hash is null or lower(p_state_hash) !~ '^[0-9a-f]{64}$' then
        return;
      end if;

      select state.id, state.tenant_id into v_state_id, v_tenant_id
        from %I.oauth_states state
       where state.state_hash = lower(p_state_hash)
         and state.used_at is null
         and state.expires_at > statement_timestamp()
       limit 1;
      if not found then return; end if;

      perform 1
        from %I.tenants tenant
       where tenant.id = v_tenant_id
         and tenant.status = 'active'
       for share;
      if not found then return; end if;

      if exists (
        select 1 from %I.data_deletion_requests request
         where request.tenant_id = v_tenant_id
           and request.scope = 'company'
           and request.status in ('pending', 'processing')
      ) then
        return;
      end if;

      return query
      update %I.oauth_states state
         set used_at = statement_timestamp()
       where state.id = v_state_id
         and state.used_at is null
         and state.expires_at > statement_timestamp()
      returning state.tenant_id, state.provider, state.connector_types;
    end
    $body$
  $function$, s, s, s, s, s, s);

  execute format('revoke all on function %I.consume_oauth_state(text) from public', s);
  execute format('grant execute on function %I.consume_oauth_state(text) to brian_app', s);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %I.consume_oauth_state(text) from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %I.consume_oauth_state(text) from authenticated', s);
  end if;
end $$;

create unique index if not exists data_deletion_one_open_account_idx
  on data_deletion_requests (target_user_id)
  where scope = 'account' and status in ('pending', 'processing');
create unique index if not exists data_deletion_one_open_company_idx
  on data_deletion_requests (tenant_id)
  where scope = 'company' and status in ('pending', 'processing');
create index if not exists data_deletion_due_idx
  on data_deletion_requests (scheduled_for, id)
  where status = 'pending';
create index if not exists data_deletion_requester_created_idx
  on data_deletion_requests (requested_by_user_id, created_at desc);
create index if not exists api_tokens_created_by_active_idx
  on api_tokens (created_by_user_id, tenant_id)
  where created_by_user_id is not null and revoked_at is null;

alter table data_deletion_requests enable row level security;
drop policy if exists tenant_isolation on data_deletion_requests;
create policy tenant_isolation on data_deletion_requests
  using (
    tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid)
  )
  with check (
    tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid)
  );

-- Keep request timestamps convergent on replay using the existing fixed-path
-- trigger function from migration 010.
drop trigger if exists brian_touch_updated_at on data_deletion_requests;
create trigger brian_touch_updated_at
  before update on data_deletion_requests
  for each row execute function brian_touch_updated_at();

do $$
declare s text := current_schema();
begin
  execute format($function$
    create or replace function %I.request_data_deletion(
      p_user_id uuid,
      p_tenant_id uuid,
      p_scope text,
      p_grace_period_days integer default 30
    )
    returns table (
      request_id uuid,
      request_scope text,
      request_status text,
      request_scheduled_for timestamptz,
      request_created_at timestamptz,
      request_cancelled_at timestamptz,
      request_completed_at timestamptz
    )
    language plpgsql
    volatile
    security definer
    set search_path = pg_catalog, %I
    as $body$
    declare
      v_context_user uuid;
      v_request_id uuid;
      v_blocking_tenant uuid;
      v_revoked_connections integer := 0;
      v_revoked_tokens integer := 0;
      v_revoked_oauth_states integer := 0;
      v_erased_connectors integer := 0;
    begin
      begin
        v_context_user := nullif(current_setting('app.user_id', true), '')::uuid;
      exception when others then
        raise exception 'not authorized' using errcode = '42501';
      end;
      if p_user_id is null or v_context_user is distinct from p_user_id then
        raise exception 'not authorized' using errcode = '42501';
      end if;
      if p_scope not in ('account', 'company')
         or p_grace_period_days not between 1 and 365 then
        raise exception 'invalid deletion request' using errcode = '22023';
      end if;

      -- The request must originate from a current active membership. This
      -- prevents arbitrary tenant ids from being used as authorization input.
      if not exists (
        select 1
          from %I.tenant_memberships m
          join %I.tenants t on t.id = m.tenant_id
         where m.tenant_id = p_tenant_id
           and m.user_id = p_user_id
           and m.status = 'active'
           and t.status = 'active'
      ) then
        raise exception 'not authorized' using errcode = '42501';
      end if;

      if p_scope = 'account' then
        -- Credential triggers take this exact key before allowing a new active
        -- grant/token. This orders insertion against the request + bulk revoke
        -- transaction instead of relying on a stale statement snapshot.
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended('brian:account-deletion:' || p_user_id::text, 0)
        );

        -- Serialize with the migration-010 ownership trigger. Locking tenant
        -- rows in a deterministic order makes the "last owner" decision safe
        -- against concurrent membership changes across several companies.
        perform t.id
          from %I.tenants t
          join %I.tenant_memberships mine on mine.tenant_id = t.id
         where mine.user_id = p_user_id and mine.status = 'active'
         order by t.id
         for update of t;

        select mine.tenant_id into v_blocking_tenant
          from %I.tenant_memberships mine
         where mine.user_id = p_user_id
           and mine.role = 'owner'
           and mine.status = 'active'
           and not exists (
             select 1 from %I.tenant_memberships another
              where another.tenant_id = mine.tenant_id
                and another.user_id <> p_user_id
                and another.role = 'owner'
                and another.status = 'active'
           )
         order by mine.tenant_id
         limit 1;
        if v_blocking_tenant is not null then
          raise exception 'transfer ownership before deleting this account'
            using errcode = '23514';
        end if;

        select d.id into v_request_id
          from %I.data_deletion_requests d
         where d.scope = 'account'
           and d.target_user_id = p_user_id
           and d.status in ('pending', 'processing')
         order by d.created_at desc
         limit 1
         for update;
        if v_request_id is null then
          insert into %I.data_deletion_requests
            (tenant_id, requested_by_user_id, target_user_id, scope,
             grace_period_days, scheduled_for)
          values (
            p_tenant_id, p_user_id, p_user_id, 'account',
            p_grace_period_days,
            statement_timestamp() + make_interval(days => p_grace_period_days)
          )
          returning id into v_request_id;

          update %I.agent_connections
             set status = 'revoked', revoked_at = statement_timestamp(),
                 expires_at = null, updated_at = statement_timestamp()
           where user_id = p_user_id and status in ('pending', 'active');
          get diagnostics v_revoked_connections = row_count;

          update %I.api_tokens
             set revoked_at = statement_timestamp()
           where created_by_user_id = p_user_id and revoked_at is null;
          get diagnostics v_revoked_tokens = row_count;

          insert into %I.security_audit_events
            (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
          select distinct
            m.tenant_id, p_user_id, 'privacy.account_deletion.scheduled',
            'data_deletion_request', v_request_id::text,
            jsonb_build_object(
              'grace_period_days', p_grace_period_days,
              'revoked_connections', v_revoked_connections,
              'revoked_attributed_legacy_tokens', v_revoked_tokens
            )
          from %I.tenant_memberships m
          where m.user_id = p_user_id;
        end if;
      else
        -- Company deletion is owner-only. The tenant lock serializes this
        -- transition with membership/owner changes and another scheduler.
        perform 1 from %I.tenants where id = p_tenant_id for update;
        if not exists (
          select 1 from %I.tenant_memberships m
           where m.tenant_id = p_tenant_id
             and m.user_id = p_user_id
             and m.role = 'owner'
             and m.status = 'active'
        ) then
          raise exception 'company deletion requires an active owner'
            using errcode = '42501';
        end if;

        select d.id into v_request_id
          from %I.data_deletion_requests d
         where d.scope = 'company'
           and d.tenant_id = p_tenant_id
           and d.status in ('pending', 'processing')
         order by d.created_at desc
         limit 1
         for update;
        if v_request_id is null then
          insert into %I.data_deletion_requests
            (tenant_id, requested_by_user_id, scope, grace_period_days, scheduled_for)
          values (
            p_tenant_id, p_user_id, 'company', p_grace_period_days,
            statement_timestamp() + make_interval(days => p_grace_period_days)
          )
          returning id into v_request_id;

          update %I.agent_connections
             set status = 'revoked', revoked_at = statement_timestamp(),
                 expires_at = null, updated_at = statement_timestamp()
           where tenant_id = p_tenant_id and status in ('pending', 'active');
          get diagnostics v_revoked_connections = row_count;

          update %I.api_tokens
             set revoked_at = statement_timestamp()
           where tenant_id = p_tenant_id and revoked_at is null;
          get diagnostics v_revoked_tokens = row_count;

          update %I.oauth_states
             set used_at = statement_timestamp()
           where tenant_id = p_tenant_id
             and used_at is null;
          get diagnostics v_revoked_oauth_states = row_count;

          update %I.connectors
             set status = 'disabled', credentials = '{}'::jsonb,
                 cursor = '{}'::jsonb, last_error = null,
                 updated_at = statement_timestamp()
           where tenant_id = p_tenant_id;
          get diagnostics v_erased_connectors = row_count;

          update %I.tenants
             set status = 'suspended', updated_at = statement_timestamp()
           where id = p_tenant_id and status = 'active';

          insert into %I.security_audit_events
            (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
          values (
            p_tenant_id, p_user_id, 'privacy.company_deletion.scheduled',
            'data_deletion_request', v_request_id::text,
            jsonb_build_object(
              'grace_period_days', p_grace_period_days,
              'revoked_connections', v_revoked_connections,
              'revoked_legacy_tokens', v_revoked_tokens,
              'revoked_oauth_states', v_revoked_oauth_states,
              'erased_connectors', v_erased_connectors
            )
          );
        end if;
      end if;

      return query
      select d.id, d.scope, d.status, d.scheduled_for, d.created_at,
             d.cancelled_at, d.completed_at
        from %I.data_deletion_requests d
       where d.id = v_request_id;
    end
    $body$
  $function$,
    s, s,
    s, s,
    s, s,
    s, s, s,
    s, s, s, s, s,
    s, s,
    s, s,
    s, s, s, s, s, s,
    s
  );

  execute format($function$
    create or replace function %I.list_my_data_deletion_requests(p_user_id uuid)
    returns table (
      request_id uuid,
      request_scope text,
      request_status text,
      request_scheduled_for timestamptz,
      request_created_at timestamptz,
      request_cancelled_at timestamptz,
      request_completed_at timestamptz
    )
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $body$
    declare v_context_user uuid;
    begin
      begin
        v_context_user := nullif(current_setting('app.user_id', true), '')::uuid;
      exception when others then
        return;
      end;
      if p_user_id is null or v_context_user is distinct from p_user_id then
        return;
      end if;

      return query
      select d.id, d.scope, d.status, d.scheduled_for, d.created_at,
             d.cancelled_at, d.completed_at
        from %I.data_deletion_requests d
       where d.requested_by_user_id = p_user_id
       order by d.created_at desc, d.id desc;
    end
    $body$
  $function$, s, s, s);

  execute format($function$
    create or replace function %I.cancel_data_deletion_request(
      p_user_id uuid,
      p_request_id uuid
    )
    returns table (
      request_id uuid,
      request_scope text,
      request_status text,
      request_scheduled_for timestamptz,
      request_created_at timestamptz,
      request_cancelled_at timestamptz,
      request_completed_at timestamptz
    )
    language plpgsql
    volatile
    security definer
    set search_path = pg_catalog, %I
    as $body$
    declare
      v_context_user uuid;
      v_scope text;
      v_tenant_id uuid;
    begin
      begin
        v_context_user := nullif(current_setting('app.user_id', true), '')::uuid;
      exception when others then
        return;
      end;
      if p_user_id is null or v_context_user is distinct from p_user_id then
        return;
      end if;

      select d.scope, d.tenant_id into v_scope, v_tenant_id
        from %I.data_deletion_requests d
       where d.id = p_request_id
         and d.requested_by_user_id = p_user_id
         and d.status = 'pending'
         and d.scheduled_for > statement_timestamp()
       for update;
      if not found then return; end if;

      if v_scope = 'company' then
        perform 1 from %I.tenants where id = v_tenant_id for update;
        if not exists (
          select 1 from %I.tenant_memberships m
           where m.tenant_id = v_tenant_id
             and m.user_id = p_user_id
             and m.role = 'owner'
             and m.status = 'active'
        ) then
          return;
        end if;
        -- This is the sole runtime path allowed to reactivate a company.
        update %I.tenants
           set status = 'active', updated_at = statement_timestamp()
         where id = v_tenant_id and status = 'suspended';
      end if;

      update %I.data_deletion_requests
         set status = 'cancelled', cancelled_at = statement_timestamp(),
             last_failure_code = null, updated_at = statement_timestamp()
       where id = p_request_id;

      if v_tenant_id is not null then
        insert into %I.security_audit_events
          (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
        values (
          v_tenant_id, p_user_id, 'privacy.' || v_scope || '_deletion.cancelled',
          'data_deletion_request', p_request_id::text,
          jsonb_build_object('credentials_restored', false)
        );
      end if;

      return query
      select d.id, d.scope, d.status, d.scheduled_for, d.created_at,
             d.cancelled_at, d.completed_at
        from %I.data_deletion_requests d
       where d.id = p_request_id;
    end
    $body$
  $function$, s, s, s, s, s, s, s, s, s);

  -- The request table is not a general Data API surface. Even brian_app reads
  -- it only through subject-bound functions, which is required for the
  -- suspended-company cancellation bootstrap path.
  execute format('revoke all on table %I.data_deletion_requests from public', s);
  execute format('revoke all on table %I.data_deletion_requests from brian_app', s);
  execute format('revoke all on function %I.request_data_deletion(uuid, uuid, text, integer) from public', s);
  execute format('revoke all on function %I.list_my_data_deletion_requests(uuid) from public', s);
  execute format('revoke all on function %I.cancel_data_deletion_request(uuid, uuid) from public', s);
  execute format('grant execute on function %I.request_data_deletion(uuid, uuid, text, integer) to brian_app', s);
  execute format('grant execute on function %I.list_my_data_deletion_requests(uuid) to brian_app', s);
  execute format('grant execute on function %I.cancel_data_deletion_request(uuid, uuid) to brian_app', s);

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on table %I.data_deletion_requests from anon', s);
    execute format('revoke all on function %I.request_data_deletion(uuid, uuid, text, integer) from anon', s);
    execute format('revoke all on function %I.list_my_data_deletion_requests(uuid) from anon', s);
    execute format('revoke all on function %I.cancel_data_deletion_request(uuid, uuid) from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on table %I.data_deletion_requests from authenticated', s);
    execute format('revoke all on function %I.request_data_deletion(uuid, uuid, text, integer) from authenticated', s);
    execute format('revoke all on function %I.list_my_data_deletion_requests(uuid) from authenticated', s);
    execute format('revoke all on function %I.cancel_data_deletion_request(uuid, uuid) from authenticated', s);
  end if;

  -- Re-assert append-only runtime audit evidence and remove direct tenant
  -- lifecycle mutation. Company suspension/reactivation now happens only in
  -- the subject/owner-bound functions above; owner maintenance deletes later.
  execute format('revoke update, delete on table %I.security_audit_events from brian_app', s);
  execute format('revoke insert, delete, update on table %I.tenants from brian_app', s);
  execute format('grant update (name, updated_at) on table %I.tenants to brian_app', s);
end $$;
