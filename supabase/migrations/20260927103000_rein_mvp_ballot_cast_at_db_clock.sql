-- Rein Agent MVP governance: make the database clock authoritative for
-- rein_mvp_ballots.cast_at.
--
-- The original ballots-before-insert guard validated the caller-provided
-- NEW.cast_at against the poll window and then stored it unchanged. The only
-- writer is service_role, so a service-role caller could backdate or postdate
-- a ballot to any instant inside the window and rewrite the recorded
-- chronology used by the (poll_id, cast_at) index and by every audit read of a
-- recorded ballot. It also let one caller pass different values for the same
-- legal instant.
--
-- The guard now assigns NEW.cast_at := now() before the bounds check, so the
-- ballot's own window check still runs but the stored value always comes from
-- the database clock. A caller-supplied cast_at is ignored instead of
-- rejected, so existing writers that still send a timestamp keep working.
--
-- This is a forward migration: 20260924095705_rein_mvp_proposals_polls_ballots
-- is already applied to the linked project, so it is not rewritten. The
-- earlier migration is left untouched and fresh installs converge here.

begin;

do $rein_mvp_ballot_clock$
declare
  prefixes text[] := array['dev_', 'prod_'];
  prefix text;
  body text;

  ballots_insert_template text := $template$
declare
  poll_status text;
  poll_vote_type text;
  poll_candidates uuid[];
  poll_max_approvals integer;
  poll_opens_at timestamptz;
  poll_closes_at timestamptz;
  approved_count integer;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  select status, vote_type, candidate_proposal_ids, max_approvals_per_voter, opens_at, closes_at
    into poll_status, poll_vote_type, poll_candidates, poll_max_approvals, poll_opens_at, poll_closes_at
    from public.{p}rein_mvp_polls
   where id = new.poll_id;
  if not found then
    raise exception 'poll % does not exist', new.poll_id
      using errcode = '23503';
  end if;

  if poll_status <> 'open' then
    raise exception 'poll % does not accept ballots while its status is %', new.poll_id, poll_status
      using errcode = '23514';
  end if;

  -- The recorded instant is the database clock, never the writer's value, so
  -- a service-role caller cannot backdate, postdate, or otherwise rewrite the
  -- chronology of a ballot. The window check still runs against the (open)
  -- poll, so a poll that has not opened yet, or one whose window has already
  -- run out, records no ballot.
  new.cast_at := now();

  if new.cast_at < poll_opens_at or new.cast_at >= poll_closes_at then
    raise exception 'a ballot must be cast inside the window of poll %', new.poll_id
      using errcode = '23514';
  end if;

  if not public.{p}rein_mvp_is_current_director(new.voter_contact_id) then
    raise exception 'voter % is not a current director', new.voter_contact_id
      using errcode = '23514';
  end if;

  if array_position(new.approved_proposal_ids, null) is not null then
    raise exception 'approved proposal ids cannot contain nulls'
      using errcode = '23514';
  end if;

  approved_count := cardinality(new.approved_proposal_ids);
  if approved_count <> cardinality(array(select distinct c from unnest(new.approved_proposal_ids) as t(c))) then
    raise exception 'a voter may approve the same proposal only once'
      using errcode = '23514';
  end if;

  if approved_count > poll_max_approvals then
    raise exception 'vote type % allows at most % approved proposals per voter', poll_vote_type, poll_max_approvals
      using errcode = '23514';
  end if;

  if not (new.approved_proposal_ids <@ poll_candidates) then
    raise exception 'every approved proposal must be a candidate of poll %', new.poll_id
      using errcode = '23514';
  end if;

  return new;
end;
$template$;
begin
  foreach prefix in array prefixes loop
    body := replace(ballots_insert_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_ballots_before_insert', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_ballots_before_insert');
  end loop;
end;
$rein_mvp_ballot_clock$;

notify pgrst, 'reload schema';

commit;
