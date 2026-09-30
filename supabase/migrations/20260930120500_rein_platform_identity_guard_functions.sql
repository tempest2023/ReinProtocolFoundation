-- Guarded operations for platform identity linking.
--
-- Every write that decides identity runs inside one security-definer function,
-- in one transaction, holding the row locks it needs. The application layer
-- never checks a condition and then writes it in a second statement, so a
-- concurrent administrator revocation and a user completion serialize on the
-- same session or link row instead of racing.
--
-- Three properties are deliberate and load-bearing:
--   * a wrong binding code, an expired challenge or a mismatched session
--     increments or records nothing that would consume the challenge. Only a
--     correct confirmation moves a challenge forward.
--   * a confirmation re-derives the digest of the address it was given and
--     requires it to equal the digest the challenge was issued for, so a
--     receipt proves control of the address it was sent to and no other,
--     registered or not.
--   * a revoked platform tuple is a tombstone. Completion refuses it, so the
--     same account cannot silently re-bind after revocation; clearing it is an
--     administrator action.
--
-- As in the governance migration, each function refuses a write from the Data
-- API roles outright, so the enforcement lives in the database rather than in a
-- route handler.

begin;

do $rein_platform_identity_guards$
declare
  prefix text;
  issue_template text;
  confirm_template text;
  complete_template text;
  revoke_template text;
  resolve_template text;
  assertion_template text;
  apply_permission_template text;
  digest_schema text;
  email_digest text;
begin
  -- A confirmed address is the whole point of the receipt, so the database has
  -- to re-derive that address from the value the caller presented instead of
  -- comparing a caller-supplied digest: the digest of any address is
  -- computable by anyone who knows it, so a caller-computed hash would let a
  -- caller confirm someone else's registered address with its own receipt.
  -- pgcrypto is installed in `public` by the community migration and sits in
  -- Supabase's `extensions` schema in a hosted project, so the qualified
  -- reference is resolved here once, by probing, rather than guessed.
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
  -- The stored digest is sha256 hex of the canonically lowercased address, as
  -- the issue path computes it, and the comparison below uses the same form.
  email_digest := format('encode(%I.digest(v_email, ''sha256''), ''hex'')', digest_schema);

  issue_template := $template$
declare
  v_session public.{p}rein_link_sessions%rowtype;
  v_recent integer;
  v_id uuid;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'link challenges reject the Data API role %', current_user using errcode = '42501';
  end if;

  select * into v_session from public.{p}rein_link_sessions
   where session_token_hash = p_session_token_hash
   for update;
  if not found then
    return query select false, 'binding_not_found', null::uuid; return;
  end if;
  if v_session.state <> 'awaiting_email' then
    return query select false, 'binding_state_invalid', null::uuid; return;
  end if;
  -- Expiry is an admission decision, and `now()` is the transaction start time: a session that was
  -- live when the call began can expire while this transaction waits on the row lock. Every
  -- admission check therefore reads `clock_timestamp()`, while the ordinary `created_at` /
  -- `updated_at` stamps keep `now()` because they record when the transaction began, not a verdict.
  if v_session.expires_at <= clock_timestamp() then
    update public.{p}rein_link_sessions set state = 'expired', updated_at = now() where id = v_session.id;
    return query select false, 'binding_expired', null::uuid; return;
  end if;

  select count(*) into v_recent from public.{p}rein_link_email_challenges
   where session_id = v_session.id and created_at > now() - interval '1 hour';
  if v_recent >= p_max_per_session then
    return query select false, 'rate_limited', null::uuid; return;
  end if;
  if p_ip_hash is not null then
    select count(*) into v_recent from public.{p}rein_link_email_challenges
     where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_recent >= p_max_per_ip then
      return query select false, 'rate_limited', null::uuid; return;
    end if;
  end if;

  -- Only the newest challenge for a session stays answerable.
  update public.{p}rein_link_email_challenges
     set code_hash = null, outcome = 'expired', updated_at = now()
   where session_id = v_session.id and outcome = 'pending';

  insert into public.{p}rein_link_email_challenges(
    session_id, email_hash, email_masked, receipt_token_hash, ip_hash, code_hash, code_expires_at)
  values (v_session.id, p_email_hash, p_email_masked, p_receipt_token_hash, p_ip_hash, p_code_hash, p_code_expires_at)
  returning id into v_id;

  insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
  values ('system', 'website:email-challenge', 'identity_link.email_issued', 'link_session', v_session.id,
    jsonb_build_object('platform', v_session.platform,
      'platform_workspace_id', v_session.platform_workspace_id,
      'email_hash', p_email_hash));

  return query select true, 'issued', v_id; return;
end;
$template$;

  confirm_template := $template$
declare
  v_session public.{p}rein_link_sessions%rowtype;
  v_challenge public.{p}rein_link_email_challenges%rowtype;
  v_email text;
  v_email_hash text;
  v_contact uuid;
  v_matches integer;
  v_created boolean := false;
  v_new_contact uuid;
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
    return query select false, 'binding_state_invalid', null::text, v_session.contact_id, 'pending'; return;
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
  -- The receipt proves control of exactly one address: the one the challenge
  -- was issued for. Re-deriving its digest here, before any contact lookup, is
  -- what stops a caller from presenting a different address (even a registered
  -- one it does not control) alongside a receipt it does control. A mismatch
  -- is refused without consuming the challenge or moving the session.
  v_email := lower(btrim(coalesce(p_email, '')));
  v_email_hash := {d};
  if v_email = '' or v_email_hash is distinct from v_challenge.email_hash then
    return query select false, 'binding_email_mismatch', v_challenge.email_masked, null::uuid, 'pending'; return;
  end if;
  -- A wrong code is counted but never consumes the challenge.
  if p_code_hash is not null and v_challenge.code_hash is not null
     and v_challenge.code_hash <> p_code_hash then
    update public.{p}rein_link_email_challenges
       set attempt_count = attempt_count + 1, updated_at = now()
     where id = v_challenge.id;
    return query select false, 'binding_code_invalid', v_challenge.email_masked, null::uuid, 'pending'; return;
  end if;

  select count(*) into v_matches from public.{p}contact_identities
   where identity_kind = 'email' and normalized_value = v_email;
  if v_matches > 1 then
    update public.{p}rein_link_email_challenges
       set outcome = 'denied_ambiguous', updated_at = now()
     where id = v_challenge.id;
    insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
    values ('system', 'website:email-verified', 'identity_link.email_conflict', 'link_session', v_session.id,
      jsonb_build_object('platform', v_session.platform,
        'platform_workspace_id', v_session.platform_workspace_id,
        'email_hash', v_challenge.email_hash));
    return query select false, 'contact_ambiguous', v_challenge.email_masked, null::uuid, 'denied_ambiguous'; return;
  end if;

  if v_matches = 1 then
    select ci.contact_id into v_contact from public.{p}contact_identities ci
     where ci.identity_kind = 'email' and ci.normalized_value = v_email;
  else
    -- A verified address that is new to us becomes a contact, and nothing more.
    -- No membership event is recorded and no Contributor or director record is
    -- created, so linking an unknown address grants no standing.
    -- `identity_link` is deliberately not a `first_source` value: that column
    -- records how someone entered the community, and completing an address
    -- check is not a new community entry. `manual` is the existing category for
    -- a record a person or process created outside the public forms, and the
    -- audit row below keeps the link-specific origin.
    insert into public.{p}community_contacts(first_source) values ('manual') returning id into v_new_contact;
    insert into public.{p}contact_identities(contact_id, identity_kind, normalized_value)
      values (v_new_contact, 'email', v_email)
      on conflict (identity_kind, normalized_value) do nothing;
    if not found then
      delete from public.{p}community_contacts where id = v_new_contact;
      select ci.contact_id into v_contact from public.{p}contact_identities ci
       where ci.identity_kind = 'email' and ci.normalized_value = v_email;
    else
      v_contact := v_new_contact;
      v_created := true;
    end if;
  end if;

  if v_contact is null then
    return query select false, 'contact_conflict', v_challenge.email_masked, null::uuid, 'pending'; return;
  end if;
  perform 1 from public.{p}community_contacts where id = v_contact and deleted_at is null;
  if not found then
    return query select false, 'contact_conflict', v_challenge.email_masked, null::uuid, 'pending'; return;
  end if;

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
      'created_contact', v_created));

  return query select true, case when v_created then 'verified_new_contact' else 'verified' end,
    v_challenge.email_masked, v_contact, 'verified'; return;
end;
$template$;

  complete_template := $template$
declare
  v_session public.{p}rein_link_sessions%rowtype;
  v_existing public.{p}rein_platform_links%rowtype;
  v_id uuid;
  v_reason text;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'link completion rejects the Data API role %', current_user using errcode = '42501';
  end if;

  if p_platform is null or p_workspace_id is null or p_platform_user_id is null then
    return query select false, 'binding_tuple_mismatch', null::uuid, null::text, null::text, null::text, null::uuid; return;
  end if;

  -- Serialize on the platform tuple before reading it, so two sessions for the
  -- same account (or a session racing an administrator revocation) queue up
  -- instead of both seeing "no row yet".
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
  -- The session's tuple is immutable, and completion refuses a tuple that does
  -- not match the one the verified event produced.
  if v_session.platform <> p_platform
     or v_session.platform_workspace_id <> p_workspace_id
     or v_session.platform_user_id <> p_platform_user_id then
    return query select false, 'binding_tuple_mismatch', null::uuid, v_session.platform,
      v_session.platform_workspace_id, v_session.platform_user_id, null::uuid; return;
  end if;

  -- Serialize on the unique tuple: this lock is what makes a concurrent
  -- administrator revocation and this completion take turns.
  select * into v_existing from public.{p}rein_platform_links
   where {p}rein_platform_links.platform = v_session.platform
     and {p}rein_platform_links.platform_workspace_id = v_session.platform_workspace_id
     and {p}rein_platform_links.platform_user_id = v_session.platform_user_id
   for update;

  -- Every lock this completion contends on is now held: the tuple advisory lock, the session row
  -- and the existing link row. The session and binding-code expiries are re-checked here, after the
  -- last of those waits, immediately before the code is consumed. The earlier checks read the clock
  -- before the link lock was taken, so a completion that queued behind a revocation or another
  -- completion past its own deadline would otherwise still consume a spent code.
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
    insert into public.{p}rein_platform_links(
      platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
      status, validity_expires_at, verified_at, verified_by)
    values (
      v_session.platform, v_session.platform_workspace_id, v_session.platform_user_id,
      v_session.platform_channel_id, v_session.contact_id,
      'verified', now() + p_validity, now(), 'website:email-verified')
    returning id into v_id;
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

  revoke_template := $template$
declare
  v_link public.{p}rein_platform_links%rowtype;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'link revocation rejects the Data API role %', current_user using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    return query select false, 'reason_required', null::uuid, null::text; return;
  end if;
  select * into v_link from public.{p}rein_platform_links where id = p_link_id for update;
  if not found then
    return query select false, 'link_not_found', null::uuid, null::text; return;
  end if;
  if v_link.status = 'revoked' then
    return query select true, 'already_revoked', v_link.contact_id, v_link.platform; return;
  end if;
  update public.{p}rein_platform_links
     set status = 'revoked', revoked_at = now(), revoked_by = p_actor,
         revoked_reason = btrim(p_reason), updated_at = now()
   where id = v_link.id;
  insert into public.{p}admin_audit_log(actor_type, actor_id, action, entity_type, entity_id, details)
  values (p_actor_type, p_actor, 'identity_link.revoked', 'platform_link', v_link.id,
    jsonb_build_object('platform', v_link.platform,
      'platform_workspace_id', v_link.platform_workspace_id,
      'contact_id', v_link.contact_id,
      'reason', btrim(p_reason)));
  return query select true, 'revoked', v_link.contact_id, v_link.platform; return;
end;
$template$;

  resolve_template := $template$
declare
  v_link public.{p}rein_platform_links%rowtype;
  v_contributor boolean := false;
  v_director boolean := false;
begin
  select * into v_link from public.{p}rein_platform_links
   where {p}rein_platform_links.platform = p_platform
     and {p}rein_platform_links.platform_workspace_id = p_workspace_id
     and {p}rein_platform_links.platform_user_id = p_platform_user_id;
  if not found then
    return query select 'identity_not_linked', null::uuid, false, false; return;
  end if;
  if v_link.status <> 'verified' then
    return query select 'identity_revoked', null::uuid, false, false; return;
  end if;
  if v_link.validity_expires_at <= clock_timestamp() then
    return query select 'identity_expired', null::uuid, false, false; return;
  end if;

  -- Eligibility is read fresh on every call; it is never carried on the link.
  select exists(
    select 1 from public.{p}contributors c
     where c.contact_id = v_link.contact_id and c.status = 'active') into v_contributor;
  select exists(
    select 1 from public.{p}people p
     where p.person_type = 'director'
       and (p.contact_id = v_link.contact_id or p.contributor_id in (
         select c.id from public.{p}contributors c where c.contact_id = v_link.contact_id))) into v_director;

  return query select 'resolved', v_link.contact_id, v_contributor, v_director; return;
end;
$template$;

  assertion_template := $template$
declare
  v_row public.{p}rein_ingress_assertions%rowtype;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'assertion validation rejects the Data API role %', current_user using errcode = '42501';
  end if;
  select * into v_row from public.{p}rein_ingress_assertions
   where assertion_token_hash = p_assertion_hash;
  if not found then
    return query select false, 'proof_unknown', null::text, null::text, null::text, null::text, null::text, null::text; return;
  end if;
  if v_row.expires_at <= clock_timestamp() then
    return query select false, 'proof_expired', null::text, null::text, null::text, null::text, null::text, null::text; return;
  end if;
  return query select true, 'ok', v_row.caller_id, v_row.platform, v_row.platform_workspace_id,
    v_row.platform_user_id, v_row.platform_channel_id, v_row.event_id; return;
end;
$template$;

  apply_permission_template := $template$
declare
  v_proposer uuid;
  v_is_director boolean := false;
begin
  select proposer_contact_id into v_proposer from public.{p}rein_proposals where id = p_proposal_id;
  if not found then return false; end if;
  if v_proposer = p_contact_id then return true; end if;
  select public.{p}rein_is_current_director(p_contact_id) into v_is_director;
  return coalesce(v_is_director, false);
end;
$template$;

  foreach prefix in array array['dev_', 'prod_'] loop
    execute format(
      'create or replace function public.%I(p_session_token_hash text, p_email text, p_email_hash text, p_email_masked text, p_receipt_token_hash text, p_code_hash text, p_code_expires_at timestamptz, p_ip_hash text, p_max_per_session integer, p_max_per_ip integer) returns table(ok boolean, reason text, challenge_id uuid) language plpgsql security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_issue_link_email_challenge', replace(issue_template, '{p}', prefix));
    execute format('revoke all on function public.%I(text,text,text,text,text,text,timestamptz,text,integer,integer) from public, anon, authenticated', prefix || 'rein_issue_link_email_challenge');
    execute format('grant execute on function public.%I(text,text,text,text,text,text,timestamptz,text,integer,integer) to service_role', prefix || 'rein_issue_link_email_challenge');

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

    execute format(
      'create or replace function public.%I(p_link_id uuid, p_actor text, p_reason text, p_actor_type text) returns table(ok boolean, reason text, contact_id uuid, platform text) language plpgsql security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_revoke_platform_link', replace(revoke_template, '{p}', prefix));
    execute format('revoke all on function public.%I(uuid,text,text,text) from public, anon, authenticated', prefix || 'rein_revoke_platform_link');
    execute format('grant execute on function public.%I(uuid,text,text,text) to service_role', prefix || 'rein_revoke_platform_link');

    execute format(
      'create or replace function public.%I(p_platform text, p_workspace_id text, p_platform_user_id text) returns table(status text, contact_id uuid, is_active_contributor boolean, is_director boolean) language plpgsql stable security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_resolve_platform_contact', replace(resolve_template, '{p}', prefix));
    execute format('revoke all on function public.%I(text,text,text) from public, anon, authenticated', prefix || 'rein_resolve_platform_contact');
    execute format('grant execute on function public.%I(text,text,text) to service_role', prefix || 'rein_resolve_platform_contact');

    execute format(
      'create or replace function public.%I(p_assertion_hash text) returns table(ok boolean, reason text, caller_id text, platform text, platform_workspace_id text, platform_user_id text, platform_channel_id text, event_id text) language plpgsql stable security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_validate_ingress_assertion', replace(assertion_template, '{p}', prefix));
    execute format('revoke all on function public.%I(text) from public, anon, authenticated', prefix || 'rein_validate_ingress_assertion');
    execute format('grant execute on function public.%I(text) to service_role', prefix || 'rein_validate_ingress_assertion');

    execute format(
      'create or replace function public.%I(p_contact_id uuid, p_proposal_id uuid) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_apply_permission', replace(apply_permission_template, '{p}', prefix));
    execute format('revoke all on function public.%I(uuid,uuid) from public, anon, authenticated', prefix || 'rein_apply_permission');
    execute format('grant execute on function public.%I(uuid,uuid) to service_role', prefix || 'rein_apply_permission');
  end loop;
end;
$rein_platform_identity_guards$;

notify pgrst, 'reload schema';

commit;
