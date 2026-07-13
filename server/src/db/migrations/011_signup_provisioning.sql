-- Provision a Brian tenant/membership from Supabase Auth user creation.
-- Authorization fields are read only from trusted raw_app_meta_data or from a
-- valid, one-time invitation. Self-service raw_user_meta_data contributes only
-- the company display name or a non-authoritative invitation-signup marker.

do $$
declare
  s text := current_schema();
  auth_users text;
begin
  auth_users := case
    when s = 'public' then 'auth.users'
    else format('%I.brian_auth_users_test', s)
  end;

  execute format($ddl$
    create or replace function %I.brian_provision_auth_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, %I
    as $function$
    declare
      v_company_name       text;
      v_slug_base          text;
      v_slug               text;
      v_tenant_id          uuid;
      v_role               text;
      v_trusted_tenant     text;
      v_invitation_id      uuid;
      v_invitation_hash    text;
      v_invitation_hash_supplied boolean := false;
      v_invitation_signup  boolean := false;
      v_make_default       boolean;
      v_signup_flag        text;
      v_attempt            integer := 0;
    begin
      -- Replay/update safe: an already-provisioned user is never moved by a
      -- later metadata edit.
      if exists (select 1 from %I.tenant_memberships where user_id = new.id) then
        return new;
      end if;

      -- Trusted administrative provisioning/backfill. raw_app_meta_data is
      -- server-controlled; raw_user_meta_data tenant/role fields are ignored.
      v_trusted_tenant := coalesce(
        new.raw_app_meta_data ->> 'brian_tenant_id',
        new.raw_app_meta_data ->> 'tenant_id'
      );
      v_role := coalesce(
        new.raw_app_meta_data ->> 'brian_role',
        new.raw_app_meta_data ->> 'role'
      );
      if v_trusted_tenant ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and v_role in ('owner', 'admin', 'expert', 'viewer') then
        select id into v_tenant_id
          from %I.tenants
         where id = v_trusted_tenant::uuid and status = 'active';
        if found then
          -- Live trusted provisioning preserves the exact administrative role.
          -- The one-time legacy founder promotion belongs only to the ranked
          -- existing-user backfill below; future founding admins stay admins.
          insert into %I.tenant_memberships
            (tenant_id, user_id, role, status, is_default)
          values (v_tenant_id, new.id, v_role, 'active', true)
          on conflict (tenant_id, user_id) do update
            set role = excluded.role,
                status = 'active',
                is_default = excluded.is_default;
          insert into %I.onboarding_state (tenant_id)
          values (v_tenant_id) on conflict (tenant_id) do nothing;
          insert into %I.security_audit_events
            (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
          values (
            v_tenant_id, new.id, 'membership.provisioned_trusted',
            'membership', new.id::text, jsonb_build_object('role', v_role)
          );
          return new;
        end if;
      end if;

      -- A trusted administrative invite may supply a server-written hash.
      -- Browser invitation signup deliberately supplies only a boolean marker
      -- and consumes the raw token after authentication through the narrow
      -- API resolver, so plaintext invitation tokens never persist in Auth
      -- user metadata.
      v_invitation_hash := lower(new.raw_app_meta_data ->> 'brian_invitation_token_hash');
      v_invitation_hash_supplied := coalesce(v_invitation_hash, '') <> '';
      v_invitation_signup := lower(coalesce(
        new.raw_user_meta_data ->> 'brian_invitation_signup', 'false'
      )) in ('1', 'true', 'yes', 'on');
      if coalesce(v_invitation_hash, '') !~ '^[0-9a-f]{64}$' then
        v_invitation_hash := null;
      end if;

      if v_invitation_hash is not null then
        select ti.id, ti.tenant_id, ti.role
          into v_invitation_id, v_tenant_id, v_role
          from %I.tenant_invitations ti
          join %I.tenants t on t.id = ti.tenant_id and t.status = 'active'
         where ti.token_hash = v_invitation_hash
           and lower(ti.email::text) = lower(new.email::text)
           and ti.accepted_at is null
           and ti.revoked_at is null
           and ti.expires_at > now()
         for update of ti;
        if found then
          v_make_default := not exists (
            select 1 from %I.tenant_memberships
             where user_id = new.id and status = 'active' and is_default
          );
          insert into %I.tenant_memberships
            (tenant_id, user_id, role, status, is_default)
          values (v_tenant_id, new.id, v_role, 'active', v_make_default)
          on conflict (tenant_id, user_id) do update
            set role = excluded.role,
                status = 'active',
                is_default = case
                  when %I.tenant_memberships.is_default then true
                  else excluded.is_default
                end;
          update %I.tenant_invitations set accepted_at = now()
           where id = v_invitation_id and accepted_at is null;
          insert into %I.onboarding_state (tenant_id)
          values (v_tenant_id) on conflict (tenant_id) do nothing;
          insert into %I.security_audit_events
            (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
          values (
            v_tenant_id, new.id, 'invitation.accepted',
            'invitation', v_invitation_id::text, jsonb_build_object('role', v_role)
          );
          return new;
        end if;
      end if;

      -- Never turn an invalid/revoked/expired trusted invitation into an
      -- unrelated self-service company signup.
      if v_invitation_hash_supplied then
        raise exception 'invalid or expired Brian invitation' using errcode = 'P0001';
      end if;

      -- A browser invitee authenticates first, then POSTs the one-time raw
      -- token to /api/invitations/accept. Suppress normal company creation in
      -- the interim; a bad token leaves a membership-less, fail-closed user.
      if v_invitation_signup then
        return new;
      end if;

      select lower(value) into v_signup_flag
        from %I.app_config where key = 'PUBLIC_SIGNUP_ENABLED';
      if coalesce(v_signup_flag, 'false') not in ('1', 'true', 'yes', 'on') then
        return new;
      end if;

      v_company_name := btrim(new.raw_user_meta_data ->> 'company_name');
      if v_company_name is null
         or char_length(v_company_name) not between 2 and 120
         or v_company_name ~ '[[:cntrl:]]' then
        raise exception 'company_name must be 2-120 printable characters'
          using errcode = '22023';
      end if;

      v_slug_base := trim(both '-' from regexp_replace(
        lower(v_company_name), '[^a-z0-9]+', '-', 'g'
      ));
      v_slug_base := left(coalesce(nullif(v_slug_base, ''), 'company'), 48);

      -- Unique constraint + retry handles concurrent equal company names.
      loop
        v_attempt := v_attempt + 1;
        if v_attempt = 1 then
          v_slug := v_slug_base;
        else
          v_slug := left(v_slug_base, 39) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
        end if;
        begin
          insert into %I.tenants (name, slug, status)
          values (v_company_name, v_slug, 'active')
          returning id into v_tenant_id;
          exit;
        exception when unique_violation then
          if v_attempt >= 20 then raise; end if;
        end;
      end loop;

      insert into %I.tenant_memberships
        (tenant_id, user_id, role, status, is_default)
      values (v_tenant_id, new.id, 'owner', 'active', true);
      insert into %I.onboarding_state (tenant_id)
      values (v_tenant_id) on conflict (tenant_id) do nothing;
      insert into %I.security_audit_events
        (tenant_id, actor_user_id, event_type, target_type, target_id, metadata)
      values (
        v_tenant_id, new.id, 'tenant.self_signup_created',
        'tenant', v_tenant_id::text, jsonb_build_object('slug', v_slug)
      );
      return new;
    end
    $function$
  $ddl$,
    s, s,
    s, s, s, s, s,
    s, s, s, s, s, s, s,
    s, s, s, s, s, s
  );

  execute format('revoke all on function %I.brian_provision_auth_user() from public', s);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %I.brian_provision_auth_user() from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %I.brian_provision_auth_user() from authenticated', s);
  end if;
  execute format('revoke all on function %I.brian_provision_auth_user() from brian_app', s);

  execute format('drop trigger if exists brian_provision_auth_user on %s', auth_users);
  execute format($sql$
    create trigger brian_provision_auth_user
      after insert or update of raw_user_meta_data, raw_app_meta_data
      on %s
      for each row execute function %I.brian_provision_auth_user()
  $sql$, auth_users, s);

  -- Trusted existing-user backfill. Only app_metadata can nominate a tenant or
  -- role. The earliest trusted founding admin becomes owner; no email-domain
  -- inference is performed.
  execute format($sql$
    with candidates as (
      select
        u.id as user_id,
        coalesce(
          u.raw_app_meta_data ->> 'brian_tenant_id',
          u.raw_app_meta_data ->> 'tenant_id'
        )::uuid as tenant_id,
        coalesce(
          u.raw_app_meta_data ->> 'brian_role',
          u.raw_app_meta_data ->> 'role'
        ) as requested_role,
        row_number() over (
          partition by coalesce(
            u.raw_app_meta_data ->> 'brian_tenant_id',
            u.raw_app_meta_data ->> 'tenant_id'
          )
          order by u.created_at, u.id
        ) as tenant_rank
      from %s u
      where coalesce(
        u.raw_app_meta_data ->> 'brian_tenant_id',
        u.raw_app_meta_data ->> 'tenant_id'
      ) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(
        u.raw_app_meta_data ->> 'brian_role',
        u.raw_app_meta_data ->> 'role'
      ) in ('owner', 'admin', 'expert', 'viewer')
    ), trusted as (
      select c.*, case
        when c.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
          and c.requested_role = 'admin' and c.tenant_rank = 1 then 'owner'
        else c.requested_role
      end as final_role
      from candidates c
      join %I.tenants t on t.id = c.tenant_id and t.status = 'active'
    )
    insert into %I.tenant_memberships
      (tenant_id, user_id, role, status, is_default)
    select
      tr.tenant_id, tr.user_id, tr.final_role, 'active',
      not exists (
        select 1 from %I.tenant_memberships existing
         where existing.user_id = tr.user_id
           and existing.status = 'active' and existing.is_default
      )
    from trusted tr
    on conflict (tenant_id, user_id) do nothing
  $sql$, auth_users, s, s, s);

  execute format($sql$
    insert into %I.onboarding_state (tenant_id)
    select distinct tenant_id from %I.tenant_memberships
    on conflict (tenant_id) do nothing
  $sql$, s, s);

  -- Owner-only deployment report: any row here needs review before rollout.
  execute format($sql$
    create or replace view %I.identity_membership_report
      with (security_invoker = true)
    as
    select
      u.id as user_id,
      u.email::text as email,
      count(m.id) filter (where m.status = 'active')::integer as active_memberships,
      count(m.id) filter (where m.status = 'active' and m.is_default)::integer as active_defaults
    from %s u
    left join %I.tenant_memberships m on m.user_id = u.id
    group by u.id, u.email
    having count(m.id) filter (where m.status = 'active') = 0
        or count(m.id) filter (where m.status = 'active' and m.is_default) <> 1
  $sql$, s, auth_users, s);
  execute format('revoke all on table %I.identity_membership_report from public', s);
  execute format('revoke all on table %I.identity_membership_report from brian_app', s);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on table %I.identity_membership_report from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on table %I.identity_membership_report from authenticated', s);
  end if;
end $$;

-- Public invitation signup needs a narrow preflight before creating an Auth
-- identity. Return only a boolean: tenant, role, inviter, and normalized email
-- remain private. The caller supplies a SHA-256 hash, never the raw token.
do $$
declare s text := current_schema();
begin
  execute format($function$
    create or replace function %I.is_valid_tenant_invitation(
      p_email text,
      p_token_hash text
    )
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $body$
      select case
        when p_email is null
          or char_length(p_email) > 320
          or p_email !~ '^[^[:space:]]+@[^[:space:]]+\.[^[:space:]]+$'
          or p_token_hash !~ '^[0-9a-f]{64}$'
        then false
        else exists (
          select 1
            from %I.tenant_invitations invitation
            join %I.tenants tenant
              on tenant.id = invitation.tenant_id and tenant.status = 'active'
           where invitation.token_hash = p_token_hash
             and lower(invitation.email::text) = lower(btrim(p_email))
             and invitation.accepted_at is null
             and invitation.revoked_at is null
             and invitation.expires_at > statement_timestamp()
        )
      end
    $body$
  $function$, s, s, s, s);

  execute format(
    'revoke all on function %I.is_valid_tenant_invitation(text,text) from public', s
  );
  execute format(
    'grant execute on function %I.is_valid_tenant_invitation(text,text) to brian_app', s
  );
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format(
      'revoke all on function %I.is_valid_tenant_invitation(text,text) from anon', s
    );
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format(
      'revoke all on function %I.is_valid_tenant_invitation(text,text) from authenticated', s
    );
  end if;
end $$;
