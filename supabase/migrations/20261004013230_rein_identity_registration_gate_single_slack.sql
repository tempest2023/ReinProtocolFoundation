begin;

do $rein_identity_registration_gate$
declare
  prefix text;
  constraint_name text;
  duplicate_count integer;
  digest_schema text;
  email_digest text;
  confirm_template text;
  complete_template text;
begin
  select n.nspname
    into digest_schema
    from pg_namespace n
   where n.nspname in ('public', 'extensions')
     and to_regprocedure(format('%I.digest(text, text)', n.nspname)) is not null
   order by (n.nspname = 'public') desc
   limit 1;
  if digest_schema is null then
    raise exception 'the platform identity guards require pgcrypto digest(text, text) in public or extensions';
  end if;
  email_digest := format('encode(%I.digest(v_email, ''sha256''), ''hex'')', digest_schema);

  confirm_template := $template$
declare
  v_session public.{p}rein_link_sessions%rowtype;
  v_challenge public.{p}rein_link_email_challenges%rowtype;
  v_email text;
  v_email_hash text;
  v_contact uuid;
  v_matches integer;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'link confirmation rejects the Data API role %', current_user using errcode = '42501';
  end if;

  select * into v_session from public.{p}rein_link_sessions
   where session_token_hash = p_session_token_hash
   for update;
  if not found then
    return query select false, 'binding_not_found', null::text, null::uuid, 'pending'; return;
  end if;
  if v_session.expires_at <= clock_timestamp() then
    update public.{p}rein_link_sessions set state = 'expired', updated_at = now() where id = v_session.id;
    return query select false, 'binding_expired', null::text, null::uuid, 'expired'; return;
  end if;
  if v_session.state <> 'awaiting_email' then
    return query select false, 'binding_state_invalid', null::text, v_session.contact_id, v_session.state; return;
  end if;

  select * into v_challenge from public.{p}rein_link_email_challenges
   where session_id = v_session.id and receipt_token_hash = p_receipt_token_hash
   for update;
  if not found or v_challenge.outcome <> 'pending' then
    return query select false, 'email_receipt_invalid', null::text, null::uuid, 'pending'; return;
  end if;
  if v_challenge.code_expires_at is not null and v_challenge.code_expires_at <= clock_timestamp() then
    update public.{p}rein_link_email_challenges
       set outcome = 'expired', code_hash = null, updated_at = now()
     where id = v_challenge.id;
    return query select false, 'binding_expired', v_challenge.email_masked, null::uuid, 'expired'; return;
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  v_email_hash := {d};
  if v_email = '' or v_email_hash is distinct from v_challenge.email_hash then
    return query select false, 'binding_email_mismatch', v_challenge.email_masked, null::uuid, 'pending'; return;
  end if;
  if p_code_hash is not null and v_challenge.code_hash is not null
     and v_challenge.code_hash <> p_code_hash then
    update public.{p}rein_link_email_challenges
       set attempt_count = attempt_count + 1, updated_at = now()
     where id = v_challenge.id;
    return query select false, 'binding_code_invalid', v_challenge.email_masked, null::uuid, 'pending'; return;
  end if;

  select count(*)
    into v_matches
    from public.{p}contact_identities ci
    join public.{p}community_contacts cc on cc.id = ci.contact_id and cc.deleted_at is null
   where ci.identity_kind = 'email' and ci.normalized_value = v_email;

  if v_matches > 1 then
    update public.{p}rein_link_email_challenges
       set outcome = 'denied_ambiguous', code_hash = null, updated_at = now()
     where id = v_challenge.id;
    insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
    values ('system', 'website:email-verified', 'identity_link.email_conflict', 'link_session', v_session.id,
      jsonb_build_object('platform', v_session.platform,
        'platform_workspace_id', v_session.platform_workspace_id,
        'email_hash', v_challenge.email_hash));
    return query select false, 'contact_ambiguous', v_challenge.email_masked, null::uuid, 'denied_ambiguous'; return;
  end if;

  if v_matches = 0 then
    update public.{p}rein_link_email_challenges
       set outcome = 'denied_unregistered', code_hash = null, updated_at = now()
     where id = v_challenge.id;
    update public.{p}rein_link_sessions
       set state = 'registration_required', email_verified_at = now(), updated_at = now()
     where id = v_session.id;
    insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
    values ('system', 'website:email-verified', 'identity_link.registration_required', 'link_session', v_session.id,
      jsonb_build_object('platform', v_session.platform,
        'platform_workspace_id', v_session.platform_workspace_id,
        'email_hash', v_challenge.email_hash));
    return query select false, 'contact_not_registered', v_challenge.email_masked, null::uuid, 'denied_unregistered'; return;
  end if;

  select ci.contact_id into v_contact
    from public.{p}contact_identities ci
    join public.{p}community_contacts cc on cc.id = ci.contact_id and cc.deleted_at is null
   where ci.identity_kind = 'email' and ci.normalized_value = v_email;

  update public.{p}rein_link_email_challenges
     set outcome = 'verified', resolved_contact_id = v_contact, code_consumed_at = now(), updated_at = now()
   where id = v_challenge.id;
  update public.{p}rein_link_sessions
     set state = 'email_verified', contact_id = v_contact, email_verified_at = now(),
         binding_code_hash = p_binding_code_hash, binding_code_expires_at = p_binding_expires_at,
         updated_at = now()
   where id = v_session.id;

  insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
  values ('system', 'website:email-verified', 'identity_link.email_verified', 'link_session', v_session.id,
    jsonb_build_object('platform', v_session.platform,
      'platform_workspace_id', v_session.platform_workspace_id,
      'contact_id', v_contact,
      'email_hash', v_challenge.email_hash,
      'created_contact', false));

  return query select true, 'verified', v_challenge.email_masked, v_contact, 'verified'; return;
end;
$template$;

  complete_template := $template$
declare
  v_session public.{p}rein_link_sessions%rowtype;
  v_existing public.{p}rein_platform_links%rowtype;
  v_other public.{p}rein_platform_links%rowtype;
  v_id uuid;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'link completion rejects the Data API role %', current_user using errcode = '42501';
  end if;

  if p_platform is null or p_workspace_id is null or p_platform_user_id is null then
    return query select false, 'binding_tuple_mismatch', null::uuid, null::text, null::text, null::text, null::uuid; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_platform || ':' || p_workspace_id || ':' || p_platform_user_id, 0));

  select * into v_session from public.{p}rein_link_sessions
   where session_token_hash = p_session_token_hash
   for update;
  if not found then
    return query select false, 'binding_not_found', null::uuid, null::text, null::text, null::text, null::uuid; return;
  end if;
  if v_session.state = 'completed' then
    return query select false, 'binding_already_completed', v_session.contact_id, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;
  if v_session.state <> 'email_verified' then
    return query select false, 'binding_not_verified', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;
  if v_session.expires_at <= clock_timestamp() then
    update public.{p}rein_link_sessions set state = 'expired', updated_at = now() where id = v_session.id;
    return query select false, 'binding_expired', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;
  if v_session.binding_code_hash is null
     or v_session.binding_code_hash <> p_binding_code_hash
     or v_session.binding_code_consumed_at is not null
     or (v_session.binding_code_expires_at is not null and v_session.binding_code_expires_at <= clock_timestamp()) then
    return query select false, 'binding_code_invalid', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;
  if v_session.contact_id is null then
    return query select false, 'binding_not_verified', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;
  if v_session.platform <> p_platform
     or v_session.platform_workspace_id <> p_workspace_id
     or v_session.platform_user_id <> p_platform_user_id then
    return query select false, 'binding_tuple_mismatch', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('contact:slack:' || v_session.contact_id::text, 0));

  select l.* into v_other from public.{p}rein_platform_links l
   where l.platform = 'slack'
     and l.contact_id = v_session.contact_id
     and l.status = 'verified'
     and not (
       l.platform_workspace_id = v_session.platform_workspace_id
       and l.platform_user_id = v_session.platform_user_id)
   order by l.id
   limit 1
   for update;
  if found then
    return query select false, 'contact_conflict', v_other.contact_id, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, v_other.id; return;
  end if;

  select * into v_existing from public.{p}rein_platform_links
   where {p}rein_platform_links.platform = v_session.platform
     and {p}rein_platform_links.platform_workspace_id = v_session.platform_workspace_id
     and {p}rein_platform_links.platform_user_id = v_session.platform_user_id
   for update;

  if v_session.expires_at <= clock_timestamp() then
    update public.{p}rein_link_sessions set state = 'expired', updated_at = now() where id = v_session.id;
    return query select false, 'binding_expired', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;
  if v_session.binding_code_expires_at is not null
     and v_session.binding_code_expires_at <= clock_timestamp() then
    return query select false, 'binding_code_invalid', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;

  if found then
    if v_existing.status = 'revoked' then
      return query select false, 'identity_revoked', v_existing.contact_id, v_session.platform,
        v_session.platform_workspace_id, v_session.platform_user_id, v_existing.id; return;
    end if;
    if v_existing.contact_id <> v_session.contact_id then
      return query select false, 'contact_conflict', v_existing.contact_id, v_session.platform,
        v_session.platform_workspace_id, v_session.platform_user_id, v_existing.id; return;
    end if;
    v_id := v_existing.id;
  else
    begin
      insert into public.{p}rein_platform_links(
        platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
        status, validity_expires_at, verified_at, verified_by)
      values (
        v_session.platform, v_session.platform_workspace_id, v_session.platform_user_id,
        v_session.platform_channel_id, v_session.contact_id,
        'verified', now() + p_validity, now(), 'website:email-verified')
      returning id into v_id;
    exception when unique_violation then
      return query select false, 'contact_conflict', v_session.contact_id, v_session.platform,
        v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
    end;
  end if;

  update public.{p}rein_link_sessions
     set state = 'completed', completed_at = now(), binding_code_consumed_at = now(), updated_at = now()
   where id = v_session.id;

  insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
  values (p_actor_type, p_actor_type, 'identity_link.completed', 'platform_link', v_id,
    jsonb_build_object('platform', v_session.platform,
      'platform_workspace_id', v_session.platform_workspace_id,
      'contact_id', v_session.contact_id));

  return query select true, 'linked', v_session.contact_id, v_session.platform,
    v_session.platform_workspace_id, v_session.platform_user_id, v_id; return;
end;
$template$;

  foreach prefix in array array['dev_', 'prod_'] loop
    execute format(
      'select count(*) from (select contact_id from public.%I where platform = ''slack'' and status = ''verified'' group by contact_id having count(*) > 1) duplicates',
      prefix || 'rein_platform_links')
      into duplicate_count;
    if duplicate_count > 0 then
      raise exception '% has contacts with multiple verified Slack links', prefix;
    end if;

    constraint_name := null;
    select c.conname into constraint_name
      from pg_constraint c
     where c.conrelid = format('public.%I', prefix || 'rein_link_sessions')::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%awaiting_email%'
       and pg_get_constraintdef(c.oid) ilike '%email_verified%'
     limit 1;
    if constraint_name is not null then
      execute format('alter table public.%I drop constraint %I', prefix || 'rein_link_sessions', constraint_name);
    end if;
    execute format(
      'alter table public.%I add constraint %I check (state in (''awaiting_email'', ''email_verified'', ''registration_required'', ''completed'', ''expired'', ''cancelled''))',
      prefix || 'rein_link_sessions', prefix || 'rein_link_sessions_state_check');

    constraint_name := null;
    select c.conname into constraint_name
      from pg_constraint c
     where c.conrelid = format('public.%I', prefix || 'rein_link_email_challenges')::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%denied_ambiguous%'
     limit 1;
    if constraint_name is not null then
      execute format('alter table public.%I drop constraint %I', prefix || 'rein_link_email_challenges', constraint_name);
    end if;
    execute format(
      'alter table public.%I add constraint %I check (outcome in (''pending'', ''verified'', ''denied_ambiguous'', ''denied_unregistered'', ''expired''))',
      prefix || 'rein_link_email_challenges', prefix || 'rein_link_email_challenges_outcome_check');

    execute format(
      'create unique index %I on public.%I(contact_id) where platform = ''slack'' and status = ''verified''',
      prefix || 'rein_platform_links_one_verified_slack_per_contact', prefix || 'rein_platform_links');

    execute format(
      'create or replace function public.%I(p_session_token_hash text, p_receipt_token_hash text, p_code_hash text, p_binding_code_hash text, p_binding_expires_at timestamptz, p_email text) returns table(ok boolean, reason text, email_masked text, contact_id uuid, outcome text) language plpgsql security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_confirm_link_email',
      replace(replace(confirm_template, '{p}', prefix), '{d}', email_digest));
    execute format('revoke all on function public.%I(text,text,text,text,timestamptz,text) from public, anon, authenticated', prefix || 'rein_confirm_link_email');
    execute format('grant execute on function public.%I(text,text,text,text,timestamptz,text) to service_role', prefix || 'rein_confirm_link_email');

    execute format(
      'create or replace function public.%I(p_session_token_hash text, p_binding_code_hash text, p_validity interval, p_platform text, p_workspace_id text, p_platform_user_id text, p_actor_type text) returns table(ok boolean, reason text, contact_id uuid, platform text, platform_workspace_id text, platform_user_id text, link_id uuid) language plpgsql security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_complete_platform_link', replace(complete_template, '{p}', prefix));
    execute format('revoke all on function public.%I(text,text,interval,text,text,text,text) from public, anon, authenticated', prefix || 'rein_complete_platform_link');
    execute format('grant execute on function public.%I(text,text,interval,text,text,text,text) to service_role', prefix || 'rein_complete_platform_link');
  end loop;
end;
$rein_identity_registration_gate$;

commit;
