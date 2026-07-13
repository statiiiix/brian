-- OAuth-token claims and the only allowed pre-tenant identity lookups. Every
-- SECURITY DEFINER function has a fixed search_path and an explicit EXECUTE
-- allowlist. Human resolvers additionally require transaction-local
-- app.user_id to match the verified JWT subject supplied by the API.

do $$
declare
  s text := current_schema();
  auth_users text := case
    when current_schema() = 'public' then 'auth.users'
    else format('%I.brian_auth_users_test', current_schema())
  end;
begin
  execute format($ddl$
    create or replace function %I.resolve_dashboard_principal(
      p_user_id uuid,
      p_tenant_id uuid default null
    )
    returns table (
      tenant_id uuid,
      user_id uuid,
      role text,
      membership_id uuid
    )
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $function$
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
      select m.tenant_id, m.user_id, m.role, m.id
        from %I.tenant_memberships m
        join %I.tenants t on t.id = m.tenant_id
       where m.user_id = p_user_id
         and m.status = 'active'
         and t.status = 'active'
         and (
           (p_tenant_id is not null and m.tenant_id = p_tenant_id)
           or (p_tenant_id is null and m.is_default)
         )
       order by m.created_at
       limit 1;
    end
    $function$
  $ddl$, s, s, s, s);

  execute format($ddl$
    create or replace function %I.list_user_memberships(p_user_id uuid)
    returns table (
      membership_id uuid,
      tenant_id uuid,
      tenant_name text,
      tenant_slug text,
      role text,
      is_default boolean
    )
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $function$
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
      select m.id, m.tenant_id, t.name, t.slug, m.role, m.is_default
        from %I.tenant_memberships m
        join %I.tenants t on t.id = m.tenant_id
       where m.user_id = p_user_id
         and m.status = 'active'
         and t.status = 'active'
       order by m.is_default desc, m.created_at, m.id;
    end
    $function$
  $ddl$, s, s, s, s);

  execute format($ddl$
    create or replace function %I.resolve_mcp_principal(
      p_user_id uuid,
      p_tenant_id uuid,
      p_client_id text
    )
    returns table (
      tenant_id uuid,
      user_id uuid,
      role text,
      permissions text[],
      connection_id uuid
    )
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $function$
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
      select c.tenant_id, c.user_id, m.role, c.permissions, c.id
        from %I.agent_connections c
        join %I.tenant_memberships m
          on m.tenant_id = c.tenant_id and m.user_id = c.user_id
        join %I.tenants t on t.id = c.tenant_id
       where c.user_id = p_user_id
         and c.tenant_id = p_tenant_id
         and c.oauth_client_id = p_client_id
         and c.status = 'active'
         and (c.expires_at is null or c.expires_at > now())
         and m.status = 'active'
         and t.status = 'active'
       limit 1;
    end
    $function$
  $ddl$, s, s, s, s, s);

  execute format($ddl$
    create or replace function %I.resolve_legacy_agent_token(p_token_hash text)
    returns table (
      tenant_id uuid,
      connection_id uuid
    )
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $function$
    begin
      if p_token_hash is null or lower(p_token_hash) !~ '^[0-9a-f]{64}$' then
        return;
      end if;
      return query
      select a.tenant_id, null::uuid
        from %I.api_tokens a
        join %I.tenants t on t.id = a.tenant_id
       where a.token_hash = lower(p_token_hash)
         and a.revoked_at is null
         and t.status = 'active'
       limit 1;
    end
    $function$
  $ddl$, s, s, s, s);

  execute format($ddl$
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
    as $function$
    begin
      if p_state_hash is null or lower(p_state_hash) !~ '^[0-9a-f]{64}$' then
        return;
      end if;
      return query
      update %I.oauth_states s
         set used_at = now()
       where s.state_hash = lower(p_state_hash)
         and s.used_at is null
         and s.expires_at > now()
      returning s.tenant_id, s.provider, s.connector_types;
    end
    $function$
  $ddl$, s, s, s);

  execute format($ddl$
    create or replace function %I.consume_tenant_invitation(
      p_user_id uuid,
      p_token_hash text
    )
    returns table (
      tenant_id uuid,
      role text
    )
    language plpgsql
    volatile
    security definer
    set search_path = pg_catalog, %I
    as $function$
    declare
      v_context_user uuid;
      v_email text;
      v_invitation_id uuid;
      v_tenant_id uuid;
      v_role text;
      v_make_default boolean;
    begin
      begin
        v_context_user := nullif(current_setting('app.user_id', true), '')::uuid;
      exception when others then
        return;
      end;
      if p_user_id is null
         or v_context_user is distinct from p_user_id
         or p_token_hash is null
         or lower(p_token_hash) !~ '^[0-9a-f]{64}$' then
        return;
      end if;

      select u.email::text into v_email from %s u where u.id = p_user_id;
      if v_email is null then return; end if;

      select i.id, i.tenant_id, i.role
        into v_invitation_id, v_tenant_id, v_role
        from %I.tenant_invitations i
        join %I.tenants t on t.id = i.tenant_id and t.status = 'active'
       where i.token_hash = lower(p_token_hash)
         and lower(i.email::text) = lower(v_email)
         and i.accepted_at is null
         and i.revoked_at is null
         and i.expires_at > now()
       for update of i;
      if not found then return; end if;

      v_make_default := not exists (
        select 1 from %I.tenant_memberships m
         where m.user_id = p_user_id and m.status = 'active' and m.is_default
      );
      insert into %I.tenant_memberships
        (tenant_id, user_id, role, status, is_default)
      values (v_tenant_id, p_user_id, v_role, 'active', v_make_default)
      on conflict on constraint tenant_memberships_tenant_id_user_id_key do update
        set role = excluded.role,
            status = 'active',
            is_default = case
              when %I.tenant_memberships.is_default then true
              else excluded.is_default
            end;
      update %I.tenant_invitations set accepted_at = now()
       where id = v_invitation_id and accepted_at is null;
      insert into %I.security_audit_events
        (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
      values (
        v_tenant_id, p_user_id, 'invitation.accepted',
        'invitation', v_invitation_id::text, jsonb_build_object('role', v_role)
      );
      return query select v_tenant_id, v_role;
    end
    $function$
  $ddl$, s, s, auth_users, s, s, s, s, s, s, s);

  execute format($ddl$
    create or replace function %I.custom_access_token_hook(event jsonb)
    returns jsonb
    language plpgsql
    volatile
    security definer
    set search_path = pg_catalog, %I
    as $function$
    declare
      v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
      v_client_id text;
      v_user_text text;
      v_user_id uuid;
      v_connection_id uuid;
      v_tenant_id uuid;
      v_role text;
      v_permissions text[];
      v_status text;
      v_count integer;
    begin
      v_client_id := nullif(coalesce(event ->> 'client_id', v_claims ->> 'client_id'), '');
      -- Ordinary dashboard/password/OTP/recovery tokens have no OAuth client.
      if v_client_id is null then return event; end if;

      v_user_text := coalesce(event ->> 'user_id', v_claims ->> 'sub');
      if v_user_text is null
         or v_user_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'OAuth token has no valid user id' using errcode = 'P0001';
      end if;
      v_user_id := v_user_text::uuid;

      select count(*)::integer into v_count
        from %I.agent_connections c
        join %I.tenant_memberships m
          on m.tenant_id = c.tenant_id and m.user_id = c.user_id
        join %I.tenants t on t.id = c.tenant_id
       where c.user_id = v_user_id
         and c.oauth_client_id = v_client_id
         and c.status in ('pending', 'active')
         and (c.expires_at is null or c.expires_at > now())
         and m.status = 'active'
         and t.status = 'active';
      if v_count <> 1 then
        raise exception 'OAuth grant is absent, inactive, or ambiguous' using errcode = 'P0001';
      end if;

      select c.id, c.tenant_id, m.role, c.permissions, c.status
        into v_connection_id, v_tenant_id, v_role, v_permissions, v_status
        from %I.agent_connections c
        join %I.tenant_memberships m
          on m.tenant_id = c.tenant_id and m.user_id = c.user_id
        join %I.tenants t on t.id = c.tenant_id
       where c.user_id = v_user_id
         and c.oauth_client_id = v_client_id
         and c.status in ('pending', 'active')
         and (c.expires_at is null or c.expires_at > now())
         and m.status = 'active'
         and t.status = 'active'
       for update of c;

      if v_status = 'pending' then
        update %I.agent_connections
           set status = 'active', approved_at = coalesce(approved_at, now()),
               expires_at = null, updated_at = now()
         where id = v_connection_id and status = 'pending';
        insert into %I.security_audit_events
          (tenant_id, actor_user_id, connection_id, event_type, target_type, target_id, metadata)
        values (
          v_tenant_id, v_user_id, v_connection_id, 'agent_connection.activated',
          'agent_connection', v_connection_id::text,
          jsonb_build_object('oauth_client_id', v_client_id)
        );
      end if;

      v_claims := jsonb_set(v_claims, '{aud}', to_jsonb('https://api.brianthebrain.app/mcp'::text), true);
      v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::text), true);
      v_claims := jsonb_set(v_claims, '{brian_role}', to_jsonb(v_role), true);
      v_claims := jsonb_set(v_claims, '{brian_permissions}', to_jsonb(v_permissions), true);
      v_claims := jsonb_set(v_claims, '{brian_connection_id}', to_jsonb(v_connection_id::text), true);
      v_claims := jsonb_set(v_claims, '{brian_resource}', to_jsonb('https://api.brianthebrain.app/mcp'::text), true);
      v_claims := jsonb_set(v_claims, '{brian_token_type}', to_jsonb('mcp'::text), true);
      return jsonb_set(event, '{claims}', v_claims, true);
    end
    $function$
  $ddl$, s, s, s, s, s, s, s, s, s, s);

  -- Remove broad hash/tenant enumeration. All pre-tenant callers now use the
  -- narrow SECURITY DEFINER functions above.
  execute format('drop policy if exists pre_tenant_lookup on %I.api_tokens', s);
  execute format('drop policy if exists pre_tenant_lookup on %I.tenants', s);

  -- Default-deny function execution, then grant only the intended server role.
  execute format('revoke all on function %I.resolve_dashboard_principal(uuid, uuid) from public', s);
  execute format('revoke all on function %I.list_user_memberships(uuid) from public', s);
  execute format('revoke all on function %I.resolve_mcp_principal(uuid, uuid, text) from public', s);
  execute format('revoke all on function %I.resolve_legacy_agent_token(text) from public', s);
  execute format('revoke all on function %I.consume_oauth_state(text) from public', s);
  execute format('revoke all on function %I.consume_tenant_invitation(uuid, text) from public', s);
  execute format('revoke all on function %I.custom_access_token_hook(jsonb) from public', s);

  execute format('grant execute on function %I.resolve_dashboard_principal(uuid, uuid) to brian_app', s);
  execute format('grant execute on function %I.list_user_memberships(uuid) to brian_app', s);
  execute format('grant execute on function %I.resolve_mcp_principal(uuid, uuid, text) to brian_app', s);
  execute format('grant execute on function %I.resolve_legacy_agent_token(text) to brian_app', s);
  execute format('grant execute on function %I.consume_oauth_state(text) to brian_app', s);
  execute format('grant execute on function %I.consume_tenant_invitation(uuid, text) to brian_app', s);
  execute format('revoke all on function %I.custom_access_token_hook(jsonb) from brian_app', s);

  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute format('grant usage on schema %I to supabase_auth_admin', s);
    execute format('grant execute on function %I.custom_access_token_hook(jsonb) to supabase_auth_admin', s);
  end if;
  -- Supabase default privileges grant EXECUTE on new public-schema functions
  -- directly to anon/authenticated; revoking PUBLIC does not remove those
  -- direct grants, so every resolver must be revoked from both roles too.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %I.resolve_dashboard_principal(uuid, uuid) from anon', s);
    execute format('revoke all on function %I.list_user_memberships(uuid) from anon', s);
    execute format('revoke all on function %I.resolve_mcp_principal(uuid, uuid, text) from anon', s);
    execute format('revoke all on function %I.resolve_legacy_agent_token(text) from anon', s);
    execute format('revoke all on function %I.consume_oauth_state(text) from anon', s);
    execute format('revoke all on function %I.consume_tenant_invitation(uuid, text) from anon', s);
    execute format('revoke all on function %I.custom_access_token_hook(jsonb) from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %I.resolve_dashboard_principal(uuid, uuid) from authenticated', s);
    execute format('revoke all on function %I.list_user_memberships(uuid) from authenticated', s);
    execute format('revoke all on function %I.resolve_mcp_principal(uuid, uuid, text) from authenticated', s);
    execute format('revoke all on function %I.resolve_legacy_agent_token(text) from authenticated', s);
    execute format('revoke all on function %I.consume_oauth_state(text) from authenticated', s);
    execute format('revoke all on function %I.consume_tenant_invitation(uuid, text) from authenticated', s);
    execute format('revoke all on function %I.custom_access_token_hook(jsonb) from authenticated', s);
  end if;
end $$;
