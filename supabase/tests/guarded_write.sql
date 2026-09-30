-- Behavioural pgTAP tests for the guarded governance write.
--
-- Every assertion calls the real function defined in
-- supabase/migrations/20260930140000_rein_governance_guarded_write.sql. The
-- seven happy paths are what matters here: each operation is dispatched through
-- the guard's own whitelist branch and must return a stored row that carries the
-- contract the writer's row shaping reads, rather than being swallowed by the
-- wrapper or refused by a check that no other suite exercises. The negative
-- cases then prove the guard refuses what it must: a caller whose registration
-- lacks the operation's scope, a caller that names an actor the binding does not
-- resolve to, an unbound tuple, and a revoked link.
--
-- Run with:  node scripts/run-identity-db-tests.mjs
-- The runner applies every migration in filename order, then runs this file
-- through psql on the same throwaway container.
--
-- The function is security definer and granted to service_role only, so this
-- suite runs as the container superuser. Fixtures are committed inside a
-- transaction that is rolled back at the end.

begin;

select plan(42);

-- ---------------------------------------------------------------------------
-- 0. Reachability.
-- ---------------------------------------------------------------------------
select is(
  has_function_privilege('service_role', 'public.dev_rein_guarded_write(text,text,text,uuid,jsonb)', 'execute'),
  true,
  'service_role can execute dev_rein_guarded_write');

select is(
  has_function_privilege('anon', 'public.dev_rein_guarded_write(text,text,text,uuid,jsonb)', 'execute'),
  false,
  'anon cannot execute dev_rein_guarded_write');

-- ---------------------------------------------------------------------------
-- Fixtures. One contact that is an active Contributor and a current director, a
-- live binding for it, and two registered callers: one holding every governance
-- scope, one holding only `governance.propose`.
-- ---------------------------------------------------------------------------
insert into public.dev_community_contacts(id, first_source)
values ('00000000-0000-4000-8000-0000000000a1', 'manual');

insert into public.dev_contributors(id, contact_id, status)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'active');

insert into public.dev_people(id, slug, display_name, person_type, role, contact_id, contributor_id)
values (
  '00000000-0000-4000-8000-0000000000c1', 'guarded-write-director', 'Guarded Write Director',
  'director', 'Director', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000b1');

insert into public.dev_rein_platform_links(
  platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
  status, validity_expires_at, verified_at, verified_by)
values (
  'slack', 'W-GW', 'U-GW', 'chan-gw', '00000000-0000-4000-8000-0000000000a1',
  'verified', now() + interval '10 years', now(), 'guarded-write-fixture');

insert into public.dev_rein_service_callers(
  caller_id, label, credential_hash, scopes, platform_allowlist, channel_allowlist, created_by, status)
values
  ('gw-full', 'full caller', 'gw-hash-full',
   array['governance.propose', 'governance.poll.open', 'governance.poll.vote',
         'governance.poll.finalize', 'governance.revision.comment',
         'governance.revision.approve', 'governance.revision.apply'],
   '[{"platform":"slack","workspace_id":"W-GW"}]'::jsonb, '["chan-gw"]'::jsonb, 'fixture', 'enabled'),
  ('gw-propose', 'propose-only caller', 'gw-hash-propose',
   array['governance.propose'],
   '[{"platform":"slack","workspace_id":"W-GW"}]'::jsonb, '["chan-gw"]'::jsonb, 'fixture', 'enabled');

insert into public.dev_rein_ingress_assertions(
  assertion_token_hash, caller_id, platform, platform_workspace_id, platform_user_id,
  platform_channel_id, event_id, source, payload_digest, expires_at)
values
  ('gw-assert-full', 'gw-full', 'slack', 'W-GW', 'U-GW', 'chan-gw', 'gw-event-1', 'relay', 'gw-d1', now() + interval '1 hour'),
  ('gw-assert-propose', 'gw-propose', 'slack', 'W-GW', 'U-GW', 'chan-gw', 'gw-event-2', 'relay', 'gw-d2', now() + interval '1 hour'),
  ('gw-assert-expired', 'gw-full', 'slack', 'W-GW', 'U-GW', 'chan-gw', 'gw-event-3', 'relay', 'gw-d3', now() - interval '1 minute'),
  ('gw-assert-other-caller', 'gw-propose', 'slack', 'W-GW', 'U-GW', 'chan-gw', 'gw-event-4', 'relay', 'gw-d4', now() + interval '1 hour'),
  ('gw-assert-other-workspace', 'gw-full', 'slack', 'W-OTHER', 'U-GW', 'chan-gw', 'gw-event-5', 'relay', 'gw-d5', now() + interval '1 hour'),
  ('gw-assert-other-channel', 'gw-full', 'slack', 'W-GW', 'U-GW', 'chan-elsewhere', 'gw-event-6', 'relay', 'gw-d6', now() + interval '1 hour');

insert into public.dev_rein_vote_types(vote_type, max_candidates, max_approvals_per_voter)
values ('gw_type', 5, 2);

-- ---------------------------------------------------------------------------
-- 1. Refusals that happen before any mutation.
-- ---------------------------------------------------------------------------

-- An operation outside the whitelist, including a null name, is refused rather
-- than dispatched. The null case is spelled out because a bare `not in` would
-- answer null and fall through to the branches.
select is(
  public.dev_rein_guarded_write('drop_everything', 'gw-assert-full', 'gw-full', null, '{}'::jsonb) ->> 'reason',
  'guard_operation_unsupported',
  'an operation outside the whitelist is refused');

select is(
  public.dev_rein_guarded_write(null, 'gw-assert-full', 'gw-full', null, '{}'::jsonb) ->> 'reason',
  'guard_operation_unsupported',
  'a null operation name is refused');

select is(
  public.dev_rein_guarded_write('cast_ballot', 'gw-assert-propose', 'gw-propose',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('poll_id', '00000000-0000-4000-8000-0000000000f9',
                       'voter_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'approved_proposal_ids', jsonb_build_array())) ->> 'reason',
  'guard_scope_missing',
  'a caller whose registration lacks the operation scope is refused');

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000e1',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000ee',
                       'title', 'Forged actor', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_actor_mismatch',
  'a caller that names an actor the binding does not resolve to is refused');

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-expired', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000e2',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'Expired proof', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_proof_expired',
  'an expired assertion is refused');

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-other-caller', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000e3',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'Foreign proof', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_assertion_mismatch',
  'an assertion minted for another caller is refused');

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-other-workspace', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000e4',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'Other workspace', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_platform_not_allowed',
  'a workspace outside the caller allowlist is refused');

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-other-channel', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000e5',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'Other channel', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_channel_not_allowed',
  'a channel outside the caller allowlist is refused');

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid, '[]'::jsonb) ->> 'reason',
  'guard_payload_invalid',
  'a payload that is not an object is refused');

select is(
  (select count(*) from public.dev_rein_proposals
    where id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2',
                 '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e4',
                 '00000000-0000-4000-8000-0000000000e5')),
  0::bigint,
  'no refused call recorded a proposal row');

-- ---------------------------------------------------------------------------
-- 2. Happy path: submit_proposal. The stored row is what the writer's
--    `proposalFromRow` reads, so it must carry exactly those columns.
-- ---------------------------------------------------------------------------
with submitted as materialized (
  select public.dev_rein_guarded_write('submit_proposal', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f1',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'The guarded proposal', 'summary', 'A summary',
                       'vote_type', 'gw_type')) as envelope)
select is(submitted.envelope ->> 'ok', 'true', 'submit_proposal: the guard reports ok') from submitted
union all
select is(jsonb_array_length(submitted.envelope -> 'rows'), 1, 'submit_proposal: exactly one row is returned') from submitted
union all
select is(submitted.envelope -> 'rows' -> 0 ->> 'id', '00000000-0000-4000-8000-0000000000f1',
          'submit_proposal: the returned row carries the proposal id') from submitted
union all
select is(submitted.envelope -> 'rows' -> 0 ->> 'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
          'submit_proposal: the actor is the contact the binding resolved to') from submitted
union all
select is(submitted.envelope -> 'rows' -> 0 ->> 'status', 'submitted',
          'submit_proposal: the stored status is submitted') from submitted
union all
select is(submitted.envelope -> 'rows' -> 0 ->> 'vote_type', 'gw_type',
          'submit_proposal: the stored vote type is the one submitted') from submitted;

-- The intake trigger records version 1 of the proposal inside the same
-- transaction, so the guard's insert is a complete proposal, not a bare row.
select is(
  (select count(*) from public.dev_rein_proposal_revisions
    where proposal_id = '00000000-0000-4000-8000-0000000000f1' and version = 1),
  1::bigint,
  'submit_proposal: intake records version 1 of the proposal');

-- ---------------------------------------------------------------------------
-- 3. Happy path: create_poll. The limits are frozen from the vote type by the
--    existing trigger.
-- ---------------------------------------------------------------------------
with created as materialized (
  select public.dev_rein_guarded_write('create_poll', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f2',
                       'creator_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'The guarded poll', 'vote_type', 'gw_type',
                       'candidate_proposal_ids', jsonb_build_array('00000000-0000-4000-8000-0000000000f1'),
                       'opens_at', (now() - interval '2 hours')::text,
                       'closes_at', (now() - interval '1 hour')::text)) as envelope)
select is(created.envelope ->> 'ok', 'true', 'create_poll: the guard reports ok') from created
union all
select is(created.envelope -> 'rows' -> 0 ->> 'candidate_limit', '5',
          'create_poll: the candidate limit is frozen from the vote type') from created
union all
select is(created.envelope -> 'rows' -> 0 ->> 'max_approvals_per_voter', '2',
          'create_poll: the approval limit is frozen from the vote type') from created
union all
select is(created.envelope -> 'rows' -> 0 ->> 'creator_contact_id', '00000000-0000-4000-8000-0000000000a1',
          'create_poll: the creator is the contact the binding resolved to') from created;

-- ---------------------------------------------------------------------------
-- 4. Happy path: cast_ballot, in a poll whose window is live.
--
--    A proposal may sit on only one poll at a time, so the poll that takes the
--    ballot freezes its own proposal and the ballot is cast into that poll while
--    it is open.
-- ---------------------------------------------------------------------------
with ballot_proposal as materialized (
  select public.dev_rein_guarded_write('submit_proposal', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f7',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'The ballot proposal', 'vote_type', 'gw_type')) as envelope)
select is(ballot_proposal.envelope ->> 'ok', 'true', 'submit_proposal: the ballot proposal is recorded') from ballot_proposal;

with ballot_round as materialized (
  select public.dev_rein_guarded_write('create_poll', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000fa',
                       'creator_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'The ballot round', 'vote_type', 'gw_type',
                       'candidate_proposal_ids', jsonb_build_array('00000000-0000-4000-8000-0000000000f7'),
                       'opens_at', (now() - interval '1 minute')::text,
                       'closes_at', (now() + interval '1 hour')::text)) as envelope)
select is(ballot_round.envelope ->> 'ok', 'true', 'create_poll: the ballot round has a live window') from ballot_round;

with ballot as materialized (
  select public.dev_rein_guarded_write('cast_ballot', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('poll_id', '00000000-0000-4000-8000-0000000000fa',
                       'voter_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'approved_proposal_ids', jsonb_build_array('00000000-0000-4000-8000-0000000000f7'))) as envelope)
select is(ballot.envelope ->> 'ok', 'true', 'cast_ballot: the guard reports ok') from ballot
union all
select is(ballot.envelope -> 'rows' -> 0 ->> 'poll_id', '00000000-0000-4000-8000-0000000000fa',
          'cast_ballot: the returned row carries the poll id') from ballot
union all
select is(ballot.envelope -> 'rows' -> 0 ->> 'voter_contact_id', '00000000-0000-4000-8000-0000000000a1',
          'cast_ballot: the voter is the contact the binding resolved to') from ballot
union all
select is(jsonb_array_length(ballot.envelope -> 'rows' -> 0 -> 'approved_proposal_ids'), 1,
          'cast_ballot: the approvals are recorded') from ballot;

-- A ballot outside the poll window is refused by the trigger and collapses to
-- the guard's fixed reason, so provider text never reaches a caller.
with early_ballot as materialized (
  select public.dev_rein_guarded_write('cast_ballot', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('poll_id', '00000000-0000-4000-8000-0000000000f2',
                       'voter_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'approved_proposal_ids', jsonb_build_array('00000000-0000-4000-8000-0000000000f1'))) as envelope)
select is(early_ballot.envelope ->> 'ok', 'false',
          'cast_ballot: a ballot into an expired window is refused') from early_ballot
union all
select is(early_ballot.envelope ->> 'reason', 'guard_write_rejected',
          'cast_ballot: the refusal is the guard''s fixed reason, never the trigger text') from early_ballot;

-- ---------------------------------------------------------------------------
-- 5. Happy path: finalize_poll.
--
--    A poll records its outcome only once its window has run out. Inside one
--    transaction `now()` is the transaction start time and does not advance, so
--    a poll created here can never be finalized here: the happy path is an
--    already-expired poll, which is the same state a real finalization runs in.
--    The vote-and-close sequence over a live window is covered by a separate
--    committed connection in the runner's concurrency phase, where the clock can
--    actually move between the two statements.
-- ---------------------------------------------------------------------------
with finalized as materialized (
  select public.dev_rein_guarded_write('finalize_poll', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('poll_id', '00000000-0000-4000-8000-0000000000f2',
                       'actor_contact_id', '00000000-0000-4000-8000-0000000000a1')) as envelope)
select is(finalized.envelope ->> 'ok', 'true', 'finalize_poll: the guard reports ok') from finalized
union all
select is(finalized.envelope -> 'rows' -> 0 ->> 'outcome', 'no_winner',
          'finalize_poll: a poll with no ballots records no_winner') from finalized
union all
select is(finalized.envelope -> 'rows' -> 0 ->> 'winning_proposal_id', null,
          'finalize_poll: no_winner records no winning proposal') from finalized
union all
select is(finalized.envelope -> 'rows' -> 0 ->> 'finalized_by_contact_id', '00000000-0000-4000-8000-0000000000a1',
          'finalize_poll: the actor is the contact the binding resolved to') from finalized
union all
select is(finalized.envelope -> 'rows' -> 0 ->> 'repeated', 'false',
          'finalize_poll: a first finalization is not a repeat') from finalized;

with repeated as materialized (
  select public.dev_rein_guarded_write('finalize_poll', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('poll_id', '00000000-0000-4000-8000-0000000000f2',
                       'actor_contact_id', '00000000-0000-4000-8000-0000000000a1')) as envelope)
select is(repeated.envelope ->> 'ok', 'true', 'finalize_poll: a second finalization reports the recorded outcome') from repeated
union all
select is(repeated.envelope -> 'rows' -> 0 ->> 'repeated', 'true',
          'finalize_poll: the stored outcome is reported as a repeat') from repeated;

-- Feedback, approval and application are accepted only around a selected
-- proposal, and a proposal becomes selected when a finalized poll records it as
-- the winner. That sequence needs a poll whose window closes, which cannot happen
-- inside one transaction because `now()` is fixed at the transaction start. The
-- runner exercises those three branches over committed statements, where the
-- clock really moves, in its guarded write happy path phase.
-- ---------------------------------------------------------------------------
-- 7. A revoked link refuses every operation, including one that would otherwise
--    succeed, and records nothing.
-- ---------------------------------------------------------------------------
update public.dev_rein_platform_links
   set status = 'revoked', revoked_at = now(), revoked_by = 'admin:test'
 where platform = 'slack' and platform_workspace_id = 'W-GW' and platform_user_id = 'U-GW';

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f4',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'After revocation', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_identity_revoked',
  'a revoked link refuses a write that would otherwise be accepted');

select is(
  (select count(*) from public.dev_rein_proposals where id = '00000000-0000-4000-8000-0000000000f4'),
  0::bigint,
  'a revoked link records no proposal row');

-- ---------------------------------------------------------------------------
-- 8. An unbound tuple refuses.
-- ---------------------------------------------------------------------------
insert into public.dev_rein_ingress_assertions(
  assertion_token_hash, caller_id, platform, platform_workspace_id, platform_user_id,
  platform_channel_id, event_id, source, payload_digest, expires_at)
values ('gw-assert-unbound', 'gw-full', 'slack', 'W-UNBOUND', 'U-NONE', 'chan-gw', 'gw-event-7', 'relay', 'gw-d7', now() + interval '1 hour');

insert into public.dev_rein_service_callers(
  caller_id, label, credential_hash, scopes, platform_allowlist, channel_allowlist, created_by, status)
values ('gw-unbound', 'unbound caller', 'gw-hash-unbound',
        array['governance.propose'], '[{"platform":"slack","workspace_id":"W-UNBOUND"}]'::jsonb,
        '["chan-gw"]'::jsonb, 'fixture', 'enabled');

update public.dev_rein_ingress_assertions
   set caller_id = 'gw-unbound'
 where assertion_token_hash = 'gw-assert-unbound';

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-unbound', 'gw-unbound',
    null,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f5',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'Unbound', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_identity_not_linked',
  'an unbound platform tuple is refused');

-- ---------------------------------------------------------------------------
-- 9. A soft-deleted contact cannot carry a write even while its link is live.
-- ---------------------------------------------------------------------------
update public.dev_rein_platform_links
   set status = 'verified', revoked_at = null, revoked_by = null
 where platform = 'slack' and platform_workspace_id = 'W-GW' and platform_user_id = 'U-GW';

update public.dev_community_contacts
   set deleted_at = now()
 where id = '00000000-0000-4000-8000-0000000000a1';

select is(
  public.dev_rein_guarded_write('submit_proposal', 'gw-assert-full', 'gw-full',
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f6',
                       'proposer_contact_id', '00000000-0000-4000-8000-0000000000a1',
                       'title', 'Deleted contact', 'vote_type', 'gw_type')) ->> 'reason',
  'guard_identity_not_linked',
  'a soft-deleted contact is refused');

select * from finish();

rollback;
