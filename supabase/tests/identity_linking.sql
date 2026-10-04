-- Behavioural pgTAP tests for the Rein platform identity guard functions.
--
-- Every assertion calls the real functions defined in
-- supabase/migrations/20260930120500_rein_platform_identity_guard_functions.sql
-- after writing fixture rows. Nothing here matches DDL text or a regex: the
-- guards are exercised by calling them.
--
-- Run with:  node scripts/run-identity-db-tests.mjs
-- That runner starts a throwaway postgres container, applies every migration in
-- filename order, then pipes this file through psql. The Supabase CLI is not
-- required.
--
-- The guards are security definer, granted to service_role only, and they raise
-- for current_user in ('anon','authenticated'), so this suite runs as the
-- container superuser. Fixtures are committed inside a transaction that is
-- rolled back at the end, on top of a throwaway database.

begin;

select plan(80);

-- ---------------------------------------------------------------------------
-- 0. The guard functions are not reachable from the Data API roles.
-- ---------------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'public.dev_rein_complete_platform_link(text,text,interval,text,text,text,text)', 'execute'),
  false,
  'anon cannot execute dev_rein_complete_platform_link');

select is(
  has_function_privilege('authenticated', 'public.dev_rein_issue_link_email_challenge(text,text,text,text,text,text,timestamptz,text,integer,integer)', 'execute'),
  false,
  'authenticated cannot execute dev_rein_issue_link_email_challenge');

select is(
  has_function_privilege('service_role', 'public.dev_rein_complete_platform_link(text,text,interval,text,text,text,text)', 'execute'),
  true,
  'service_role can execute dev_rein_complete_platform_link');

-- ---------------------------------------------------------------------------
-- Fixtures: one link session per tuple under test.
--
--   tok-SA   slack / W-A / U-A   first tuple for the alpha address
--   tok-SB   slack / W-A / U-B   second tuple, same address
--   tok-SA2  slack / W-A / U-A   same tuple again, different address
--   tok-SC   slack / W-C / U-C   tuple that is revoked
--   tok-SC2  slack / W-C / U-C   fresh session on the revoked tuple
--   tok-SE   slack / W-E / U-E   wrong code, then the correct code
--   tok-SF   slack / W-F / U-F   brand-new address (grants no standing)
--   tok-SG   slack / W-G / U-G   a receipt whose address is swapped for a
--                                different, registered one at confirmation
-- ---------------------------------------------------------------------------
insert into public.dev_rein_link_sessions(
  id, platform, platform_workspace_id, platform_user_id, platform_channel_id,
  state, session_token_hash, expires_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'slack', 'W-A', 'U-A', 'chan-a', 'awaiting_email', 'tok-SA',  now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000b1', 'slack', 'W-A', 'U-B', 'chan-b', 'awaiting_email', 'tok-SB',  now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000a2', 'slack', 'W-A', 'U-A', 'chan-a', 'awaiting_email', 'tok-SA2', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000c1', 'slack', 'W-C', 'U-C', 'chan-c', 'awaiting_email', 'tok-SC',  now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000c2', 'slack', 'W-C', 'U-C', 'chan-c', 'awaiting_email', 'tok-SC2', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000e1', 'slack', 'W-E', 'U-E', 'chan-e', 'awaiting_email', 'tok-SE',  now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000f1', 'slack', 'W-F', 'U-F', 'chan-f', 'awaiting_email', 'tok-SF',  now() + interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000d1', 'slack', 'W-G', 'U-G', 'chan-g', 'awaiting_email', 'tok-SG',  now() + interval '1 hour');

select is(
  (select count(*) from public.dev_rein_link_sessions where session_token_hash like 'tok-S%'),
  8::bigint,
  'fixture: eight link sessions are in flight');

insert into public.dev_community_contacts(id, first_source)
values
  ('00000000-0000-4000-8000-000000001001', 'manual'),
  ('00000000-0000-4000-8000-000000001002', 'manual'),
  ('00000000-0000-4000-8000-000000001003', 'manual'),
  ('00000000-0000-4000-8000-000000001004', 'manual'),
  ('00000000-0000-4000-8000-000000001005', 'manual'),
  ('00000000-0000-4000-8000-000000001006', 'manual');

insert into public.dev_contact_identities(contact_id, identity_kind, normalized_value)
values
  ('00000000-0000-4000-8000-000000001001', 'email', 'alpha@example.test'),
  ('00000000-0000-4000-8000-000000001002', 'email', 'delta@example.test'),
  ('00000000-0000-4000-8000-000000001003', 'email', 'charlie@example.test'),
  ('00000000-0000-4000-8000-000000001004', 'email', 'echo@example.test'),
  ('00000000-0000-4000-8000-000000001005', 'email', 'attacker@example.test'),
  ('00000000-0000-4000-8000-000000001006', 'email', 'expiry@example.test');

-- ---------------------------------------------------------------------------
-- 1. Cross-scope acceptance and tuple uniqueness.
-- ---------------------------------------------------------------------------

-- Tuple A: a brand-new address becomes a contact through the challenge flow.
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SA', p_email := 'alpha@example.test',
    p_email_hash := encode(public.digest('alpha@example.test', 'sha256'), 'hex'),
    p_email_masked := 'a***@example.test', p_receipt_token_hash := 'rcpt-A', p_code_hash := 'ch-A',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: the tuple A challenge is issued') from issued
union all
select is(issued.reason, 'issued', 'issue: the tuple A reason is issued') from issued;

with confirmed as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SA', p_email := 'alpha@example.test', p_receipt_token_hash := 'rcpt-A', p_code_hash := 'ch-A',
    p_binding_code_hash := 'bc-A', p_binding_expires_at := now() + interval '10 minutes'))
select is(confirmed.ok, true, 'confirm: the tuple A address is confirmed') from confirmed
union all
select is(confirmed.reason, 'verified', 'confirm: the registered address resolves to its contact') from confirmed
union all
select is(confirmed.outcome, 'verified', 'confirm: the challenge outcome is verified') from confirmed;

with linked as materialized (
  select * from public.dev_rein_complete_platform_link(
    p_session_token_hash := 'tok-SA', p_binding_code_hash := 'bc-A', p_validity := interval '10 years',
    p_platform := 'slack', p_workspace_id := 'W-A', p_platform_user_id := 'U-A', p_actor_type := 'system'))
select is(linked.ok, true, 'complete: tuple A links') from linked
union all
select is(linked.reason, 'linked', 'complete: the tuple A reason is linked') from linked
union all
select is(
  linked.contact_id,
  (select contact_id from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'alpha@example.test'),
  'complete: tuple A is bound to the contact that owns the address') from linked;

-- Tuple B: a different Slack tuple for the same contact is refused.
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SB', p_email := 'alpha@example.test',
    p_email_hash := encode(public.digest('alpha@example.test', 'sha256'), 'hex'),
    p_email_masked := 'a***@example.test', p_receipt_token_hash := 'rcpt-B', p_code_hash := 'ch-B',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: the tuple B challenge is issued') from issued;

with confirmed as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SB', p_email := 'alpha@example.test', p_receipt_token_hash := 'rcpt-B', p_code_hash := 'ch-B',
    p_binding_code_hash := 'bc-B', p_binding_expires_at := now() + interval '10 minutes'))
select is(confirmed.ok, true, 'confirm: tuple B confirms the same address') from confirmed
union all
select is(confirmed.reason, 'verified', 'confirm: a known address does not create a second contact') from confirmed;

with linked_b as materialized (
  select * from public.dev_rein_complete_platform_link(
    p_session_token_hash := 'tok-SB', p_binding_code_hash := 'bc-B', p_validity := interval '10 years',
    p_platform := 'slack', p_workspace_id := 'W-A', p_platform_user_id := 'U-B', p_actor_type := 'system'))
select is(linked_b.ok, false, 'complete: a second Slack tuple for the same contact is refused') from linked_b
union all
select is(linked_b.reason, 'contact_conflict', 'complete: the second Slack tuple reports contact_conflict') from linked_b;

select is(
  (select count(*) from public.dev_rein_platform_links l
    where l.contact_id = (select contact_id from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'alpha@example.test')),
  1::bigint,
  'one contact holds one verified Slack link');

-- The SAME tuple twice, reaching completion with a different contact, is
-- refused by the occupied tuple.
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SA2', p_email := 'delta@example.test',
    p_email_hash := encode(public.digest('delta@example.test', 'sha256'), 'hex'),
    p_email_masked := 'd***@example.test', p_receipt_token_hash := 'rcpt-A2', p_code_hash := 'ch-A2',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: a second session on tuple A is issued') from issued;

with confirmed as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SA2', p_email := 'delta@example.test', p_receipt_token_hash := 'rcpt-A2', p_code_hash := 'ch-A2',
    p_binding_code_hash := 'bc-A2', p_binding_expires_at := now() + interval '10 minutes'))
select is(confirmed.ok, true, 'confirm: the second session verifies a different address') from confirmed;

with relinked as materialized (
  select * from public.dev_rein_complete_platform_link(
    p_session_token_hash := 'tok-SA2', p_binding_code_hash := 'bc-A2', p_validity := interval '10 years',
    p_platform := 'slack', p_workspace_id := 'W-A', p_platform_user_id := 'U-A', p_actor_type := 'system'))
select is(relinked.ok, false, 'complete: an occupied tuple with a different contact is refused') from relinked
union all
select is(relinked.reason, 'contact_conflict', 'complete: the refusal reason is contact_conflict') from relinked;

select is(
  (select count(*) from public.dev_rein_platform_links where platform = 'slack' and platform_workspace_id = 'W-A' and platform_user_id = 'U-A'),
  1::bigint,
  'the tuple still holds exactly one link row');

select is(
  (select contact_id from public.dev_rein_platform_links where platform = 'slack' and platform_workspace_id = 'W-A' and platform_user_id = 'U-A'),
  (select contact_id from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'alpha@example.test'),
  'the original contact keeps the tuple');

-- ---------------------------------------------------------------------------
-- 2. Replay: completing the same session token twice creates nothing new.
-- ---------------------------------------------------------------------------
with replayed as materialized (
  select * from public.dev_rein_complete_platform_link(
    p_session_token_hash := 'tok-SA', p_binding_code_hash := 'bc-A', p_validity := interval '10 years',
    p_platform := 'slack', p_workspace_id := 'W-A', p_platform_user_id := 'U-A', p_actor_type := 'system'))
select is(replayed.ok, false, 'replay: completing the same session twice is refused') from replayed
union all
select is(replayed.reason, 'binding_already_completed', 'replay: the reason is binding_already_completed') from replayed;

select is(
  (select count(*) from public.dev_rein_platform_links where platform = 'slack' and platform_workspace_id = 'W-A' and platform_user_id = 'U-A'),
  1::bigint,
  'replay: no second link row was created');

-- ---------------------------------------------------------------------------
-- 3. Revocation is a tombstone.
-- ---------------------------------------------------------------------------
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SC', p_email := 'charlie@example.test',
    p_email_hash := encode(public.digest('charlie@example.test', 'sha256'), 'hex'),
    p_email_masked := 'c***@example.test', p_receipt_token_hash := 'rcpt-C', p_code_hash := 'ch-C',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: the tuple C challenge is issued') from issued;

with confirmed as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SC', p_email := 'charlie@example.test', p_receipt_token_hash := 'rcpt-C', p_code_hash := 'ch-C',
    p_binding_code_hash := 'bc-C', p_binding_expires_at := now() + interval '10 minutes'))
select is(confirmed.ok, true, 'confirm: the tuple C address is confirmed') from confirmed;

with linked as materialized (
  select * from public.dev_rein_complete_platform_link(
    p_session_token_hash := 'tok-SC', p_binding_code_hash := 'bc-C', p_validity := interval '10 years',
    p_platform := 'slack', p_workspace_id := 'W-C', p_platform_user_id := 'U-C', p_actor_type := 'system'))
select is(linked.ok, true, 'complete: tuple C links') from linked;

with revoked as materialized (
  select * from public.dev_rein_revoke_platform_link(
    p_link_id := (select id from public.dev_rein_platform_links where platform = 'slack' and platform_workspace_id = 'W-C' and platform_user_id = 'U-C'),
    p_actor := 'admin:test', p_reason := 'test revocation of a linked tuple', p_actor_type := 'system'))
select is(revoked.ok, true, 'revoke: the link is revoked') from revoked
union all
select is(revoked.reason, 'revoked', 'revoke: the reason is revoked') from revoked;

select is(
  (select status from public.dev_rein_resolve_platform_contact('slack', 'W-C', 'U-C')),
  'identity_revoked',
  'resolve: a revoked tuple reports identity_revoked');

-- A fresh, fully qualified completion for the same tuple is still refused: the
-- revoked row is a tombstone, not a free slot.
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SC2', p_email := 'echo@example.test',
    p_email_hash := encode(public.digest('echo@example.test', 'sha256'), 'hex'),
    p_email_masked := 'e***@example.test', p_receipt_token_hash := 'rcpt-C2', p_code_hash := 'ch-C2',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: a fresh session on the revoked tuple is issued') from issued;

with confirmed as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SC2', p_email := 'echo@example.test', p_receipt_token_hash := 'rcpt-C2', p_code_hash := 'ch-C2',
    p_binding_code_hash := 'bc-C2', p_binding_expires_at := now() + interval '10 minutes'))
select is(confirmed.ok, true, 'confirm: the fresh session verifies its address') from confirmed;

with refused as materialized (
  select * from public.dev_rein_complete_platform_link(
    p_session_token_hash := 'tok-SC2', p_binding_code_hash := 'bc-C2', p_validity := interval '10 years',
    p_platform := 'slack', p_workspace_id := 'W-C', p_platform_user_id := 'U-C', p_actor_type := 'system'))
select is(refused.ok, false, 'complete: a revoked tuple refuses a fresh completion') from refused
union all
select is(refused.reason, 'identity_revoked', 'complete: the refusal reason is identity_revoked') from refused;

select is(
  (select count(*) from public.dev_rein_platform_links where platform = 'slack' and platform_workspace_id = 'W-C' and platform_user_id = 'U-C'),
  1::bigint,
  'the tombstone is the only row for the revoked tuple');

select is(
  (select status from public.dev_rein_platform_links where platform = 'slack' and platform_workspace_id = 'W-C' and platform_user_id = 'U-C'),
  'revoked',
  'the tombstone keeps status revoked');

-- ---------------------------------------------------------------------------
-- 4. A wrong binding code is counted but consumes nothing.
-- ---------------------------------------------------------------------------
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SE', p_email := 'alpha@example.test',
    p_email_hash := encode(public.digest('alpha@example.test', 'sha256'), 'hex'),
    p_email_masked := 'a***@example.test', p_receipt_token_hash := 'rcpt-E', p_code_hash := 'ch-E',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: the tuple E challenge is issued') from issued;

with wrong as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SE', p_email := 'alpha@example.test', p_receipt_token_hash := 'rcpt-E', p_code_hash := 'WRONG-CODE',
    p_binding_code_hash := 'bc-E', p_binding_expires_at := now() + interval '10 minutes'))
select is(wrong.ok, false, 'confirm: a wrong code is refused') from wrong
union all
select is(wrong.reason, 'binding_code_invalid', 'confirm: the wrong-code reason is binding_code_invalid') from wrong
union all
select is(wrong.outcome, 'pending', 'confirm: a wrong code leaves the challenge outcome pending') from wrong;

select is(
  (select outcome from public.dev_rein_link_email_challenges where receipt_token_hash = 'rcpt-E'),
  'pending',
  'the challenge row is still pending after a wrong code');

select is(
  (select code_consumed_at from public.dev_rein_link_email_challenges where receipt_token_hash = 'rcpt-E'),
  null::timestamptz,
  'a wrong code consumes nothing');

select is(
  (select attempt_count from public.dev_rein_link_email_challenges where receipt_token_hash = 'rcpt-E'),
  1,
  'a wrong code is counted once');

with right_code as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SE', p_email := 'alpha@example.test', p_receipt_token_hash := 'rcpt-E', p_code_hash := 'ch-E',
    p_binding_code_hash := 'bc-E', p_binding_expires_at := now() + interval '10 minutes'))
select is(right_code.ok, true, 'confirm: the correct code then succeeds') from right_code
union all
select is(right_code.outcome, 'verified', 'confirm: the correct code verifies the challenge') from right_code;

-- ---------------------------------------------------------------------------
-- 5. The ambiguous-address branch is unreachable through contact_identities:
--    the unique constraint on (identity_kind, normalized_value) forbids the two
--    matching rows the guard would need to see. The constraint is asserted here
--    instead of inventing a scenario the schema cannot hold. Note the constraint
--    compares the stored text exactly, so callers must store an already
--    normalized value; two spellings differing only in case would coexist and
--    still never both match the guard's exact-match lookup.
-- ---------------------------------------------------------------------------
select throws_ok(
  $sql$
    insert into public.dev_contact_identities(contact_id, identity_kind, normalized_value)
    values (
      (select contact_id from public.dev_contact_identities
        where identity_kind = 'email' and normalized_value = 'alpha@example.test'),
      'email',
      'alpha@example.test')
  $sql$,
  '23505',
  null,
  'duplicate (identity_kind, normalized_value) is rejected, so denied_ambiguous cannot be produced');

-- ---------------------------------------------------------------------------
-- 6. A verified unknown address requires registration and creates nothing.
-- ---------------------------------------------------------------------------
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SF', p_email := 'fresh@example.test',
    p_email_hash := encode(public.digest('fresh@example.test', 'sha256'), 'hex'),
    p_email_masked := 'f***@example.test', p_receipt_token_hash := 'rcpt-F', p_code_hash := 'ch-F',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'issue: the tuple F challenge is issued') from issued;

with confirmed as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SF', p_email := 'fresh@example.test', p_receipt_token_hash := 'rcpt-F', p_code_hash := 'ch-F',
    p_binding_code_hash := 'bc-F', p_binding_expires_at := now() + interval '10 minutes'))
select is(confirmed.ok, false, 'confirm: a verified unknown address is refused') from confirmed
union all
select is(confirmed.reason, 'contact_not_registered', 'confirm: the unknown address requires registration') from confirmed;

select is(
  (select count(*) from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'fresh@example.test'),
  0::bigint,
  'the unknown address creates no identity row');

select is(
  (select count(*) from public.dev_member_count_events e
    where e.contact_id = (select contact_id from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'fresh@example.test')),
  0::bigint,
  'refusing an unknown address records no member count event');

select is(
  (select count(*) from public.dev_contributors c
    where c.contact_id = (select contact_id from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'fresh@example.test')),
  0::bigint,
  'refusing an unknown address creates no contributor');

select is(
  (select count(*) from public.dev_people p
    where p.contact_id = (select contact_id from public.dev_contact_identities where identity_kind = 'email' and normalized_value = 'fresh@example.test')),
  0::bigint,
  'refusing an unknown address creates no person record');

-- ---------------------------------------------------------------------------
-- 7. A receipt proves the address it was sent to, and no other.
--
--    This is the attack the digest comparison below exists to stop: a caller
--    that controls only its own address obtains a receipt for it and then
--    presents a registered victim address with that receipt. Before the guard
--    re-derived the digest, the confirmation accepted the caller-supplied
--    address outright, so the receipt proved the wrong address and the
--    victim's binding was created from a mailbox the caller never had.
-- ---------------------------------------------------------------------------
with issued as materialized (
  select * from public.dev_rein_issue_link_email_challenge(
    p_session_token_hash := 'tok-SG', p_email := 'attacker@example.test',
    p_email_hash := encode(public.digest('attacker@example.test', 'sha256'), 'hex'),
    p_email_masked := 'at***@example.test', p_receipt_token_hash := 'rcpt-G', p_code_hash := 'ch-G',
    p_code_expires_at := now() + interval '10 minutes', p_ip_hash := null,
    p_max_per_session := 10, p_max_per_ip := 10))
select is(issued.ok, true, 'receipt: the attacker challenge is issued for the attacker address') from issued;

with stolen as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SG', p_email := 'alpha@example.test', p_receipt_token_hash := 'rcpt-G',
    p_code_hash := 'ch-G', p_binding_code_hash := 'bc-G', p_binding_expires_at := now() + interval '10 minutes'))
select is(stolen.ok, false, 'receipt: a receipt for another address cannot confirm a victim address') from stolen
union all
select is(stolen.reason, 'binding_email_mismatch', 'receipt: the swapped-address reason is binding_email_mismatch') from stolen
union all
select is(stolen.outcome, 'pending', 'receipt: a swapped address leaves the challenge pending') from stolen;

select is(
  (select state from public.dev_rein_link_sessions where session_token_hash = 'tok-SG'),
  'awaiting_email',
  'receipt: the session does not advance on a swapped address');

select is(
  (select code_consumed_at from public.dev_rein_link_email_challenges where receipt_token_hash = 'rcpt-G'),
  null::timestamptz,
  'receipt: a swapped address consumes nothing');

select is(
  (select count(*) from public.dev_rein_platform_links
    where platform = 'slack' and platform_workspace_id = 'W-G' and platform_user_id = 'U-G'),
  0::bigint,
  'receipt: no binding exists for the attacked tuple');

with right_address as materialized (
  select * from public.dev_rein_confirm_link_email(
    p_session_token_hash := 'tok-SG', p_email := 'attacker@example.test', p_receipt_token_hash := 'rcpt-G',
    p_code_hash := 'ch-G', p_binding_code_hash := 'bc-G', p_binding_expires_at := now() + interval '10 minutes'))
select is(right_address.ok, true, 'receipt: the receipt still confirms the address it was issued for') from right_address
union all
select is(right_address.outcome, 'verified', 'receipt: the correct address verifies the challenge') from right_address;

select is(
  (select resolved_contact_id from public.dev_rein_link_email_challenges
    where receipt_token_hash = 'rcpt-G'),
  (select contact_id from public.dev_contact_identities
    where identity_kind = 'email' and normalized_value = 'attacker@example.test'),
  'receipt: the challenge resolves to the contact that owns the address the receipt was issued for');

-- ---------------------------------------------------------------------------
-- 8. An ingress assertion stays usable until it expires.
-- ---------------------------------------------------------------------------
insert into public.dev_rein_ingress_assertions(
  assertion_token_hash, caller_id, platform, platform_workspace_id, platform_user_id,
  platform_channel_id, event_id, source, payload_digest, expires_at)
values ('assert-hash-1', 'caller-1', 'slack', 'W-A', 'U-A', 'chan-a', 'evt-1', 'relay', 'digest-1', now() + interval '10 minutes');

select is((select ok from public.dev_rein_validate_ingress_assertion('assert-hash-1')), true, 'assertion: a live assertion validates');
select is((select reason from public.dev_rein_validate_ingress_assertion('assert-hash-1')), 'ok', 'assertion: the live reason is ok');
select is((select ok from public.dev_rein_validate_ingress_assertion('assert-hash-1')), true, 'assertion: the same assertion validates again within its TTL');

update public.dev_rein_ingress_assertions
   set expires_at = now() - interval '1 minute'
 where assertion_token_hash = 'assert-hash-1';

select is((select ok from public.dev_rein_validate_ingress_assertion('assert-hash-1')), false, 'assertion: a backdated assertion is refused');
select is((select reason from public.dev_rein_validate_ingress_assertion('assert-hash-1')), 'proof_expired', 'assertion: the backdated reason is proof_expired');
select is((select reason from public.dev_rein_validate_ingress_assertion('assert-hash-unknown')), 'proof_unknown', 'assertion: an unknown hash is proof_unknown');

-- ---------------------------------------------------------------------------
-- 9. Resolution is scoped to the stored workspace.
-- ---------------------------------------------------------------------------
select is(
  (select status from public.dev_rein_resolve_platform_contact('slack', 'W-OTHER', 'U-A')),
  'identity_not_linked',
  'resolve: a different workspace id reports identity_not_linked');

select is(
  (select status from public.dev_rein_resolve_platform_contact('slack', 'W-A', 'U-A')),
  'resolved',
  'resolve: the linked tuple resolves');

select is(
  (select is_active_contributor from public.dev_rein_resolve_platform_contact('slack', 'W-A', 'U-A')),
  false,
  'resolve: eligibility is read fresh, and this contact is not a contributor');

-- ---------------------------------------------------------------------------
-- 10. Expiry admission reads the live clock, not the transaction start.
--
--     `now()` is fixed at the transaction start, so a session, code, link or
--     assertion that expires *after* that instant is still live to a check
--     written against `now()`. Every admission check reads `clock_timestamp()`,
--     so the same row is refused once real time passes its expiry. The rows
--     below expire within seconds and the suite waits them out, which is the
--     only way to observe the difference from inside one transaction.
-- ---------------------------------------------------------------------------
insert into public.dev_rein_link_sessions(
  id, platform, platform_workspace_id, platform_user_id, platform_channel_id,
  state, session_token_hash, contact_id, email_verified_at,
  binding_code_hash, binding_code_expires_at, expires_at)
values (
  '00000000-0000-4000-8000-0000000000e9', 'slack', 'W-EXP', 'U-EXP', 'chan-exp',
  'email_verified', 'tok-expiry-session',
  (select contact_id from public.dev_contact_identities
    where identity_kind = 'email' and normalized_value = 'expiry@example.test'),
  now(), 'expiry-binding-code',
  clock_timestamp() + interval '1 second', clock_timestamp() + interval '1 second');

-- Wait past both expiries on the live clock; `now()` does not move, so only a
-- `clock_timestamp()` check can see this.
select pg_sleep(2);

select is(
  (select reason from public.dev_rein_complete_platform_link(
     p_session_token_hash := 'tok-expiry-session',
     p_binding_code_hash := 'expiry-binding-code',
     p_validity := interval '10 years',
     p_platform := 'slack', p_workspace_id := 'W-EXP', p_platform_user_id := 'U-EXP',
     p_actor_type := 'system')),
  'binding_expired',
  'expiry: a session that lapsed during the wait is refused on the live clock');

select is(
  (select state from public.dev_rein_link_sessions where session_token_hash = 'tok-expiry-session'),
  'expired',
  'expiry: the lapsed session is marked expired');

select is(
  (select count(*) from public.dev_rein_platform_links
    where platform = 'slack' and platform_workspace_id = 'W-EXP' and platform_user_id = 'U-EXP'),
  0::bigint,
  'expiry: no link row was created for the lapsed session');

-- A link whose validity lapses is refused by resolve, the read path the route
-- uses to admit a caller.
insert into public.dev_rein_platform_links(
  platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
  status, validity_expires_at, verified_at, verified_by)
values (
  'slack', 'W-EXP', 'U-EXP-2', 'chan-exp',
  (select contact_id from public.dev_contact_identities
    where identity_kind = 'email' and normalized_value = 'expiry@example.test'),
  'verified', clock_timestamp() + interval '1 second', now(), 'expiry-fixture');

select pg_sleep(2);

select is(
  (select status from public.dev_rein_resolve_platform_contact('slack', 'W-EXP', 'U-EXP-2')),
  'identity_expired',
  'expiry: a link whose validity lapsed reports identity_expired on the live clock');

-- An assertion whose expiry passes during the wait is refused by the validator.
insert into public.dev_rein_ingress_assertions(
  assertion_token_hash, caller_id, platform, platform_workspace_id, platform_user_id,
  platform_channel_id, event_id, source, payload_digest, expires_at)
values (
  'assert-hash-expiry', 'caller-exp', 'slack', 'W-EXP', 'U-EXP', 'chan-exp',
  'evt-exp', 'relay', 'digest-exp', clock_timestamp() + interval '1 second');

select pg_sleep(2);

select is(
  (select reason from public.dev_rein_validate_ingress_assertion('assert-hash-expiry')),
  'proof_expired',
  'expiry: a proof that lapsed during the wait is refused on the live clock');

select * from finish();
