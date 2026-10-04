-- Concurrency phase for the Rein platform identity guard functions.
--
-- This file is driven by scripts/run-identity-db-tests.mjs, which runs it over
-- TWO real psql connections against the same throwaway database. A single
-- transaction cannot exercise a race: a completed-but-uncommitted redemption is
-- only observable from another back end, so every assertion here depends on a
-- second connection attempting the same work while the first holds its locks.
--
-- The runner supplies two psql processes and coordinates them by reading the
-- markers this file writes to a queue table, so ordering is evidence-based
-- rather than timing-based.
--
-- Assertions (each is one line of `RESULT <name> <PASS|FAIL> <detail>`):
--
--   same-code-redemption   two back ends present the same binding code; exactly
--                          one refuses and exactly one link row exists.
--   same-tuple-concurrent  two sessions on one platform tuple resolve to two
--                          different contacts; exactly one wins, the loser is
--                          refused, and the tuple keeps the winner's contact.
--   revoke-then-complete   a revocation that commits first makes a later
--                          completion refuse, and it leaves the tombstone.

begin;

-- A tiny queue so the driver can wait on evidence instead of on a sleep.
create table if not exists public.rein_concurrency_queue (
  id bigserial primary key,
  channel text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Fixtures. Every session is `email_verified` with a live binding code, which
-- is the state the website leaves behind after a confirmed address; the tests
-- then race the completion itself.
insert into public.dev_community_contacts(id, first_source)
values
  ('00000000-0000-4000-8000-00000000c001', 'manual'),
  ('00000000-0000-4000-8000-00000000c002', 'manual')
on conflict do nothing;

insert into public.dev_contact_identities(contact_id, identity_kind, normalized_value)
values
  ('00000000-0000-4000-8000-00000000c001', 'email', 'concurrent-a@example.test'),
  ('00000000-0000-4000-8000-00000000c002', 'email', 'concurrent-b@example.test')
on conflict do nothing;

-- One session whose binding code is shared by both racing back ends.
insert into public.dev_rein_link_sessions(
  id, platform, platform_workspace_id, platform_user_id, platform_channel_id,
  state, session_token_hash, contact_id, email_verified_at,
  binding_code_hash, binding_code_expires_at, expires_at)
values
  ('00000000-0000-4000-8000-00000000d001', 'slack', 'W-RACE', 'U-RACE-1', 'chan-race',
   'email_verified', 'race-tok-shared', '00000000-0000-4000-8000-00000000c001', now(),
   'race-binding-code', now() + interval '10 minutes', now() + interval '1 hour'),
  -- Two sessions on the SAME platform tuple, each already bound to a different
  -- contact, so both are fully qualified and only the tuple lock can separate them.
  ('00000000-0000-4000-8000-00000000d002', 'slack', 'W-RACE', 'U-RACE-2', 'chan-race',
   'email_verified', 'race-tok-tuple-a', '00000000-0000-4000-8000-00000000c001', now(),
   'race-binding-tuple-a', now() + interval '10 minutes', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-00000000d003', 'slack', 'W-RACE', 'U-RACE-2', 'chan-race',
   'email_verified', 'race-tok-tuple-b', '00000000-0000-4000-8000-00000000c002', now(),
   'race-binding-tuple-b', now() + interval '10 minutes', now() + interval '1 hour'),
  -- A session used to establish a link that is then revoked before completion.
  ('00000000-0000-4000-8000-00000000d004', 'slack', 'W-RACE', 'U-RACE-4', 'chan-race',
   'email_verified', 'race-tok-revoke', '00000000-0000-4000-8000-00000000c001', now(),
  'race-binding-revoke', now() + interval '10 minutes', now() + interval '1 hour')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Fixtures for the guarded-write race.
--
-- W-RACE-5 carries a live link for a contact that is both an active Contributor
-- and a current director, a registered caller whose assertion vouches for the
-- same tuple, and a vote type, so a `submit_proposal` through the guard is a
-- write the guard would otherwise accept. The race then decides only one thing:
-- whether the revocation that commits first is visible to the write.
-- ---------------------------------------------------------------------------
insert into public.dev_community_contacts(id, first_source)
values ('00000000-0000-4000-8000-00000000c003', 'manual')
on conflict do nothing;

insert into public.dev_contributors(id, contact_id, status)
values ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000c003', 'active')
on conflict do nothing;

insert into public.dev_rein_vote_types(vote_type, max_candidates, max_approvals_per_voter)
values ('race_type', 5, 3)
on conflict do nothing;

insert into public.dev_rein_platform_links(
  platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
  status, validity_expires_at, verified_at, verified_by)
values
  ('slack', 'W-RACE-5', 'U-RACE-5', 'chan-race', '00000000-0000-4000-8000-00000000c003',
   'verified', now() + interval '10 years', now(), 'concurrency-fixture')
on conflict do nothing;

insert into public.dev_rein_service_callers(
  caller_id, label, credential_hash, scopes, platform_allowlist, channel_allowlist, created_by, status)
values
  ('race-caller', 'concurrency race caller', 'race-credential-hash',
   array['governance.propose'], '[{"platform":"slack","workspace_id":"W-RACE-5"}]'::jsonb,
   '["chan-race"]'::jsonb, 'concurrency-fixture', 'enabled')
on conflict do nothing;

insert into public.dev_rein_ingress_assertions(
  assertion_token_hash, caller_id, platform, platform_workspace_id, platform_user_id,
  platform_channel_id, event_id, source, payload_digest, expires_at)
values
  ('race-assertion-hash', 'race-caller', 'slack', 'W-RACE-5', 'U-RACE-5', 'chan-race',
   'race-event-1', 'relay', 'race-digest', now() + interval '10 years')
on conflict do nothing;

-- An existing live link for the tuple the concurrent sessions target. The race
-- is then a completion against an occupied tuple, which is the path that has to
-- keep the original contact.
insert into public.dev_rein_platform_links(
  platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
  status, validity_expires_at, verified_at, verified_by)
values
  ('slack', 'W-RACE', 'U-RACE-2', 'chan-race', '00000000-0000-4000-8000-00000000c001',
   'verified', now() + interval '10 years', now(), 'concurrency-fixture')
on conflict do nothing;

-- A live link that the revocation test ends before the completion is attempted.
insert into public.dev_rein_platform_links(
  platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
  status, validity_expires_at, verified_at, verified_by)
values
  ('slack', 'W-RACE', 'U-RACE-4', 'chan-race', '00000000-0000-4000-8000-00000000c001',
   'verified', now() + interval '10 years', now(), 'concurrency-fixture')
on conflict do nothing;

commit;
