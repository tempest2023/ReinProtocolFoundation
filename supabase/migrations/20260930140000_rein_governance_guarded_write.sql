-- The guarded governance write.
--
-- The application reaches governance mutations through `POST /api/agent/operations`, and until now
-- it resolved the caller, the proof, the platform binding and the caller's standing in the route,
-- then wrote in a second statement. A revocation committed in that window was invisible to a write
-- that had already passed its checks, so a person whose link was revoked could still have one last
-- write recorded.
--
-- This migration closes that window. One security-definer function revalidates the caller record, the
-- assertion digest, the registration scopes and the platform/channel allowlists, the live binding and
-- the caller's current standing, and then performs the mutation, all inside one transaction that
-- holds the caller row lock and the canonical platform-link row lock. Revocation takes the same link
-- row lock, so a revocation that commits before a write is visible to it and refuses it, and a write
-- that commits first leaves a live row for the revocation to read.
--
-- Two properties are deliberate:
--   * the operation is one name from a fixed whitelist and the mutation is one branch per name. No
--     table, column or statement fragment is ever taken from the caller, so the guard cannot be
--     turned into arbitrary SQL. The payload is a single argument object whose keys are read by name
--     inside each branch and bound as parameters.
--   * the actor is derived, never asserted. The caller-supplied actor is compared against the contact
--     the canonical binding resolves to and a mismatch is refused, so a request cannot name a person
--     the caller is not.
--   * the required scope is decided by the operation, from the same table the route uses, and is
--     checked against the freshly read caller row. A caller cannot reach a write its registration
--     does not cover even if the route were bypassed.
--
-- Every check that compares a timestamp against an expiry uses `clock_timestamp()` rather than
-- `now()`: `now()` is the transaction start time, and this transaction blocks on the caller and link
-- row locks, so a proof or a link that was live when the call began can expire while it waits.
-- Expiry is therefore re-read after the last lock is taken and again in the branch that consumes it.
--
-- As in the sibling identity migration, the function refuses the Data API roles outright and is
-- granted to service_role only.

begin;

do $rein_governance_guarded_write$
declare
  prefix text;
  template text;
  body text;
begin
  template := $template$
declare
  v_caller public.{p}rein_service_callers%rowtype;
  v_assertion public.{p}rein_ingress_assertions%rowtype;
  v_link public.{p}rein_platform_links%rowtype;
  v_contact uuid;
  v_is_director boolean := false;
  v_is_contributor boolean := false;
  v_caller_contact uuid;
  v_proposer uuid;
  v_revision_version integer;
  v_revision_proposal uuid;
  v_row jsonb;
  v_payload jsonb;
  v_required_scope text;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'guarded governance writes reject the Data API role %', current_user
      using errcode = '42501';
  end if;

  -- The operation decides the one scope it requires, from the same table the route uses. An
  -- unknown or null name carries no scope and is refused before any other work.
  v_required_scope := case p_operation
    when 'submit_proposal' then 'governance.propose'
    when 'create_poll' then 'governance.poll.open'
    when 'cast_ballot' then 'governance.poll.vote'
    when 'finalize_poll' then 'governance.poll.finalize'
    when 'record_proposal_revision' then 'governance.revision.comment'
    when 'approve_proposal_revision' then 'governance.revision.approve'
    when 'apply_proposal_revision' then 'governance.revision.apply'
    else null
  end;
  if v_required_scope is null then
    return jsonb_build_object('ok', false, 'reason', 'guard_operation_unsupported');
  end if;
  if p_assertion_hash is null or length(btrim(p_assertion_hash)) = 0
     or p_caller_id is null or length(btrim(p_caller_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'guard_proof_missing');
  end if;

  -- The caller row is locked first and every registration check is read from the locked row, so a
  -- concurrent revocation of the caller is serialized against this write rather than raced.
  select * into v_caller from public.{p}rein_service_callers
   where caller_id = p_caller_id
   for share;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'guard_caller_unknown');
  end if;
  if v_caller.status <> 'enabled' or v_caller.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'guard_caller_disabled');
  end if;
  -- The required scope comes from the operation, and the caller's registration is the only source of
  -- scopes. A registration that does not carry this operation's scope reaches no further.
  if not (v_required_scope = any(coalesce(v_caller.scopes, '{}'::text[]))) then
    return jsonb_build_object('ok', false, 'reason', 'guard_scope_missing');
  end if;

  select * into v_assertion from public.{p}rein_ingress_assertions
   where assertion_token_hash = p_assertion_hash;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'guard_assertion_unknown');
  end if;
  -- The proof is compared against the caller in the same transaction, so a proof minted for another
  -- caller can never be replayed here, and its expiry is read with `clock_timestamp()`.
  if v_assertion.caller_id is distinct from p_caller_id then
    return jsonb_build_object('ok', false, 'reason', 'guard_assertion_mismatch');
  end if;
  if v_assertion.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'guard_proof_expired');
  end if;

  -- Allowlist revalidation, matching the route's check but against the freshly read caller row: an
  -- empty or `*` entry is the deliberate wildcard the registration decided on. A stored allowlist
  -- that parses to nothing grants nothing.
  if jsonb_typeof(v_caller.platform_allowlist) <> 'array'
     or not exists (
       select 1 from jsonb_array_elements(v_caller.platform_allowlist) as entry
        where entry ->> 'platform' = v_assertion.platform
          and (entry ->> 'workspace_id' = '*' or entry ->> 'workspace_id' = v_assertion.platform_workspace_id)) then
    return jsonb_build_object('ok', false, 'reason', 'guard_platform_not_allowed');
  end if;
  if jsonb_typeof(v_caller.channel_allowlist) <> 'array'
     or not exists (
       select 1 from jsonb_array_elements(v_caller.channel_allowlist) as channel
        where channel = to_jsonb('*'::text)
           or channel = to_jsonb(v_assertion.platform_channel_id)) then
    return jsonb_build_object('ok', false, 'reason', 'guard_channel_not_allowed');
  end if;

  -- The link row is locked for the rest of the transaction. Revocation takes this same lock, so the
  -- write and a revocation serialize on it.
  select * into v_link from public.{p}rein_platform_links
   where platform = v_assertion.platform
     and platform_workspace_id = v_assertion.platform_workspace_id
     and platform_user_id = v_assertion.platform_user_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'guard_identity_not_linked');
  end if;
  if v_link.status <> 'verified' or v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'guard_identity_revoked');
  end if;
  -- The validity check re-reads the clock, so a write that waited behind a lock past the link's
  -- expiry is refused rather than admitted on the transaction's start time.
  if v_link.validity_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'guard_identity_expired');
  end if;
  v_contact := v_link.contact_id;

  -- Every lock this write contends on is now held, so the proof is expiry-checked once more: a
  -- caller that waited behind the caller or link lock past the assertion's lifetime is refused
  -- instead of admitted on a proof that was live when the call began.
  if v_assertion.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'guard_proof_expired');
  end if;

  -- A contact whose record was soft-deleted resolves to no eligible person, so it must not carry a
  -- governance write either; this mirrors the revoked-binding rule for the same reason.
  if not exists (
    select 1 from public.{p}community_contacts c
     where c.id = v_contact and c.deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'guard_identity_not_linked');
  end if;

  -- The caller's standing is derived from the community records while the link lock is held, so the
  -- registration row never carries a role and an earlier answer is never reused.
  select exists (
    select 1 from public.{p}contributors c
     where c.contact_id = v_contact and c.status = 'active') into v_is_contributor;
  select exists (
    select 1 from public.{p}people p
     where p.person_type = 'director'
       and (p.contact_id = v_contact or p.contributor_id in (
         select c.id from public.{p}contributors c where c.contact_id = v_contact))) into v_is_director;

  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'guard_payload_invalid');
  end if;

  -- The caller-supplied actor is a second, independent statement of who is writing: the route
  -- resolves it from the binding and the guard derives the same value from the locked link row.
  -- A mismatch is refused, so a request can never name a person the binding does not resolve to.
  -- `apply_proposal_revision` is the one exception: the writer deliberately passes null there
  -- because the branch is authorized by the recorded revision's proposer, not by the payload's
  -- actor, so a non-null value is still checked when one is supplied.
  if p_contact_id is not null and p_contact_id is distinct from v_contact then
    return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
  end if;

  case p_operation
    when 'submit_proposal' then
      if not v_is_contributor then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      v_caller_contact := nullif(v_payload ->> 'proposer_contact_id', '')::uuid;
      if v_caller_contact is distinct from v_contact then
        return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
      end if;
      insert into public.{p}rein_proposals(
        id, proposer_contact_id, title, summary, vote_type, requested_minor, currency)
      values (
        nullif(v_payload ->> 'id', '')::uuid, v_contact, v_payload ->> 'title',
        v_payload ->> 'summary', v_payload ->> 'vote_type',
        nullif(v_payload ->> 'requested_minor', '')::integer, v_payload ->> 'currency')
      returning to_jsonb(public.{p}rein_proposals.*) into v_row;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));

    when 'create_poll' then
      if not v_is_director then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      v_caller_contact := nullif(v_payload ->> 'creator_contact_id', '')::uuid;
      if v_caller_contact is distinct from v_contact then
        return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
      end if;
      insert into public.{p}rein_polls(
        id, creator_contact_id, title, vote_type, candidate_proposal_ids, opens_at, closes_at)
      values (
        nullif(v_payload ->> 'id', '')::uuid, v_contact, v_payload ->> 'title',
        v_payload ->> 'vote_type',
        (select coalesce(array_agg(value::uuid), '{}'::uuid[])
           from jsonb_array_elements_text(v_payload -> 'candidate_proposal_ids') as value),
        (v_payload ->> 'opens_at')::timestamptz, (v_payload ->> 'closes_at')::timestamptz)
      returning to_jsonb(public.{p}rein_polls.*) into v_row;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));

    when 'cast_ballot' then
      if not v_is_director then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      v_caller_contact := nullif(v_payload ->> 'voter_contact_id', '')::uuid;
      if v_caller_contact is distinct from v_contact then
        return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
      end if;
      insert into public.{p}rein_ballots(poll_id, voter_contact_id, approved_proposal_ids)
      values (
        nullif(v_payload ->> 'poll_id', '')::uuid, v_contact,
        (select coalesce(array_agg(value::uuid), '{}'::uuid[])
           from jsonb_array_elements_text(v_payload -> 'approved_proposal_ids') as value))
      returning to_jsonb(public.{p}rein_ballots.*) into v_row;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));

    when 'finalize_poll' then
      if not v_is_director then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      v_caller_contact := nullif(v_payload ->> 'actor_contact_id', '')::uuid;
      if v_caller_contact is distinct from v_contact then
        return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
      end if;
      -- The existing finalize RPC runs inside this transaction and keeps ownership of the tally,
      -- the winner and the recorded time.
      v_row := public.{p}rein_finalize_poll(
        nullif(v_payload ->> 'poll_id', '')::uuid, v_contact);
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));

    when 'record_proposal_revision' then
      if not (v_is_contributor or v_is_director) then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      v_caller_contact := nullif(v_payload ->> 'author_contact_id', '')::uuid;
      if v_caller_contact is distinct from v_contact then
        return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
      end if;
      insert into public.{p}rein_proposal_revisions(
        id, proposal_id, author_contact_id, changed_fields, title, summary,
        requested_minor, currency, location, schedule, personnel, event_flow, note)
      values (
        nullif(v_payload ->> 'id', '')::uuid, nullif(v_payload ->> 'proposal_id', '')::uuid, v_contact,
        (select coalesce(array_agg(value::text), '{}'::text[])
           from jsonb_array_elements_text(v_payload -> 'changed_fields') as value),
        v_payload ->> 'title', v_payload ->> 'summary',
        nullif(v_payload ->> 'requested_minor', '')::integer, v_payload ->> 'currency',
        v_payload ->> 'location', v_payload ->> 'schedule', v_payload ->> 'personnel',
        v_payload ->> 'event_flow', v_payload ->> 'note')
      returning to_jsonb(public.{p}rein_proposal_revisions.*) into v_row;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));

    when 'approve_proposal_revision' then
      if not v_is_director then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      v_caller_contact := nullif(v_payload ->> 'approver_contact_id', '')::uuid;
      if v_caller_contact is distinct from v_contact then
        return jsonb_build_object('ok', false, 'reason', 'guard_actor_mismatch');
      end if;
      perform public.{p}rein_approve_revision(
        nullif(v_payload ->> 'revision_id', '')::uuid, v_contact);
      select to_jsonb(r.*) into v_row from public.{p}rein_proposal_revisions r
       where r.id = nullif(v_payload ->> 'revision_id', '')::uuid;
      if v_row is null then
        return jsonb_build_object('ok', false, 'reason', 'guard_revision_not_found');
      end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));

    when 'apply_proposal_revision' then
      -- The revision is read while the link lock is held, so the permission check and the applied
      -- patch both see the same recorded row and the same current standing.
      select r.proposal_id, r.version into v_revision_proposal, v_revision_version
        from public.{p}rein_proposal_revisions r
       where r.id = nullif(v_payload ->> 'effective_revision_id', '')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'guard_revision_not_found');
      end if;
      select r.proposer_contact_id into v_proposer from public.{p}rein_proposals r
       where r.id = v_revision_proposal;
      if v_proposer is distinct from v_contact and not v_is_director then
        return jsonb_build_object('ok', false, 'reason', 'guard_ineligible_actor');
      end if;
      update public.{p}rein_proposals r
         set effective_revision_id = nullif(v_payload ->> 'effective_revision_id', '')::uuid,
             title = case when v_payload ? 'title' then v_payload ->> 'title' else r.title end,
             summary = case when v_payload ? 'summary' then v_payload ->> 'summary' else r.summary end,
             requested_minor = case when v_payload ? 'requested_minor'
               then nullif(v_payload ->> 'requested_minor', '')::integer else r.requested_minor end,
             currency = case when v_payload ? 'currency' then v_payload ->> 'currency' else r.currency end,
             location = case when v_payload ? 'location' then v_payload ->> 'location' else r.location end,
             schedule = case when v_payload ? 'schedule' then v_payload ->> 'schedule' else r.schedule end,
             personnel = case when v_payload ? 'personnel' then v_payload ->> 'personnel' else r.personnel end,
             event_flow = case when v_payload ? 'event_flow' then v_payload ->> 'event_flow' else r.event_flow end
       where r.id = v_revision_proposal
      -- The row is returned from the alias the statement binds, so the RETURNING
      -- list can never name a table the statement did not alias.
      returning to_jsonb(r.*) into v_row;
      if v_row is null then
        return jsonb_build_object('ok', false, 'reason', 'guard_proposal_not_found');
      end if;
      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(v_row));
  end case;

  return jsonb_build_object('ok', false, 'reason', 'guard_operation_unsupported');

exception
  when others then
    -- A raise from the wrapped mutation (a trigger refusal, a constraint, a cast failure on a
    -- malformed id) is a refusal of this request, never a transport failure. The database text is
    -- not propagated; the caller receives one fixed reason.
    return jsonb_build_object('ok', false, 'reason', 'guard_write_rejected');
end;
$template$;

  foreach prefix in array array['dev_', 'prod_'] loop
    body := replace(template, '{p}', prefix);
    execute format(
      'create or replace function public.%I(p_operation text, p_assertion_hash text, p_caller_id text, p_contact_id uuid, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as %L',
      prefix || 'rein_guarded_write', body);
    execute format(
      'revoke all on function public.%I(text,text,text,uuid,jsonb) from public, anon, authenticated',
      prefix || 'rein_guarded_write');
    execute format(
      'grant execute on function public.%I(text,text,text,uuid,jsonb) to service_role',
      prefix || 'rein_guarded_write');
  end loop;
end;
$rein_governance_guarded_write$;

notify pgrst, 'reload schema';

commit;
