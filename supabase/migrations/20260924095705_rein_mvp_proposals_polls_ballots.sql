-- Rein Agent MVP governance: proposal intake, approval-only polls, ballots,
-- post-winning feedback, and result finalization.
--
-- Scope is schema only. No payment, signing, publication, or identity/weight
-- escalation exists here, and the Agent receives no write access. Both
-- environments receive the identical structure in this one transaction, with
-- foreign keys staying inside their own prefix.
--
-- Confirmed rules encoded below:
--   * an active Contributor proposes, and a director opens the poll and votes;
--   * a poll is approval-only and chooses among named proposal candidates;
--   * one ballot per voter per poll, and an empty approved_proposal_ids array
--     is the abstention;
--   * vote-type rules are operator configuration with no implicit default: a
--     poll names an existing vote_types row and freezes that row's candidate
--     limit and per-voter approval limit at creation time;
--   * every candidate must be an existing proposal carrying the poll's own
--     vote_type, so a poll cannot mix types or invent candidates;
--   * the poll outcome is carried back onto the proposal row as
--     status = 'selected' or 'unselected', and that write is accepted only
--     from rein_mvp_finalize_poll. The finalize function and the proposals
--     guard each recompute the approval count from the ballots, so a caller
--     cannot record a "selected" proposal that did not carry the strictly
--     highest approval count; a tie between the leading candidates, a poll
--     with no approvals at all, and a poll where every ballot abstained all
--     record no winner. The poll row keeps the tally evidence, the director
--     who finalized it (finalized_by_contact_id) and the winner, which is
--     null whenever the ballots produced none. No winner is invented.
--   * rein_mvp_finalize_poll is also the only way a poll closes, and only
--     once now() has reached closes_at, so no caller can shut a poll early and
--     strand the voters who have not voted yet. Cancelling is the separate
--     early exit, and finalizing an already finalized poll returns the
--     recorded outcome instead of counting again.
--   * feedback on a recorded proposal is append-only: one small
--     rein_mvp_proposal_revisions table holds comments and suggested
--     revisions. It is the post-result path, so a comment or suggested
--     revision is accepted only on a proposal the poll recorded as the
--     winner, whose status is 'selected'; the revision the proposal was
--     submitted with is its version 1, written by the proposal's own origin
--     trigger rather than by a caller. changed_fields names what moved, and
--     every name has a column on the proposal row it describes: 'title',
--     'summary', 'budget' (requested_minor plus currency), 'location',
--     'schedule', 'personnel' (personnel composition), and 'event_flow'
--     (major event flow). Version 1 is the content the proposal was submitted
--     with; a later revision takes its version when it becomes effective.
--     Prior versions are never rewritten, and an empty changed_fields array
--     is a comment, which is never effective.
--   * an applied revision must move exactly the fields it named and
--     reproduce exactly the values it recorded, so a review cannot pretend to
--     change a proposal.
--   * a budget, location, schedule, personnel composition, or major event
--     flow change is material and takes effect only with a recorded approval
--     from a contact who is a current director at that moment. A wording
--     change to title or summary is minor and the Agent may apply it without
--     one. Both kinds are versioned and immutable once applied.
--   * a proposal may enter a new poll only while its status is 'submitted' or
--     'unselected', and two open polls may not share a candidate.
--
-- Access model for every table below: RLS is enabled, anon and authenticated
-- hold no table privileges, and service_role is the only grantee. Server-side
-- code already reaches application data with the secret key
-- (lib/supabase/secret.ts), so no policy is created for anon or authenticated:
-- RLS with zero policies denies every non-privileged role, including any grant
-- a future default ACL might add. Widen this deliberately in the change that
-- needs it.
--
-- The guards below also reject any write from the Data API roles outright, so
-- the enforcement lives in the database rather than in a prompt or manifest.

begin;

do $rein_mvp_phase_two$
declare
  prefix text;
  table_name text;
  body text;
  environment_tables text[] := array[
    'rein_mvp_vote_types',
    'rein_mvp_proposals',
    'rein_mvp_polls',
    'rein_mvp_ballots',
    'rein_mvp_proposal_revisions'
  ];

  proposals_write_template text := $template$
declare
  revision_id uuid;
  revision_proposal_id uuid;
  revision_version integer;
  revision_fields text[];
  revision_title text;
  revision_summary text;
  revision_requested_minor integer;
  revision_currency text;
  revision_location text;
  revision_schedule text;
  revision_personnel text;
  revision_event_flow text;
  revision_approved_by uuid;
  material_field_names constant text[] := array[
    'budget', 'location', 'schedule', 'personnel', 'event_flow'];
  finalized_poll_id uuid;
  finalized_poll_status text;
  finalized_poll_at timestamptz;
  finalized_poll_candidates uuid[];
  finalizing_contact_id uuid;
  leading_proposal_id uuid;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'proposals are not deleted; record status withdrawn instead'
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'INSERT' then
    perform 1 from public.{p}community_contacts where id = new.proposer_contact_id;
    if not found then
      raise exception 'proposal proposer % has no community contact record', new.proposer_contact_id
        using errcode = '23503';
    end if;

    perform 1
      from public.{p}contributors
     where contact_id = new.proposer_contact_id
       and status = 'active';
    if not found then
      raise exception 'proposal proposer % is not an active Contributor', new.proposer_contact_id
        using errcode = '23514';
    end if;

    if new.status <> 'submitted' then
      raise exception 'a new proposal starts in submitted status, not %', new.status
        using errcode = '23514';
    end if;

    new.version := 1;
    new.effective_revision_id := null;
    return new;
  end if;

  if new.id <> old.id
     or new.proposer_contact_id <> old.proposer_contact_id
     or new.vote_type <> old.vote_type
     or new.created_at <> old.created_at then
    raise exception 'a recorded proposal keeps its proposer, vote type, and creation time'
      using errcode = 'restrict_violation';
  end if;

  if new.status <> old.status
     and not (old.status = 'submitted' and new.status in ('selected', 'unselected', 'withdrawn'))
     and not (old.status = 'selected' and new.status = 'withdrawn')
     and not (old.status = 'unselected' and new.status in ('selected', 'withdrawn')) then
    raise exception 'proposal status cannot move from % to %', old.status, new.status
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status
     and new.status in ('selected', 'unselected') then
    finalized_poll_id := nullif(current_setting('rein_mvp.finalize_poll_id', true), '')::uuid;
    finalizing_contact_id := nullif(current_setting('rein_mvp.finalize_actor', true), '')::uuid;

    if finalized_poll_id is null then
      raise exception 'proposal % can only be marked % by rein_mvp_finalize_poll', new.id, new.status
        using errcode = '23514';
    end if;

    select status, finalized_at, candidate_proposal_ids
      into finalized_poll_status, finalized_poll_at, finalized_poll_candidates
      from public.{p}rein_mvp_polls
     where id = finalized_poll_id;
    if not found then
      raise exception 'poll % does not exist', finalized_poll_id
        using errcode = '23503';
    end if;

    if finalized_poll_status <> 'closed' or finalized_poll_at is not null then
      raise exception 'poll % records its outcome once, and only after it is closed', finalized_poll_id
        using errcode = '23514';
    end if;

    if not (new.id = any(finalized_poll_candidates)) then
      raise exception 'proposal % is not a candidate of poll %', new.id, finalized_poll_id
        using errcode = '23514';
    end if;

    if finalizing_contact_id is null
       or not public.{p}rein_mvp_is_current_director(finalizing_contact_id) then
      raise exception 'the contact finalizing poll % is not a current director', finalized_poll_id
        using errcode = '23514';
    end if;

    leading_proposal_id := public.{p}rein_mvp_poll_winner(finalized_poll_id);

    if new.status = 'selected' and leading_proposal_id is distinct from new.id then
      raise exception 'proposal % does not carry the highest approval count in poll %', new.id, finalized_poll_id
        using errcode = '23514';
    end if;

    if new.status = 'unselected' and leading_proposal_id = new.id then
      raise exception 'the leading proposal of poll % cannot be recorded as unselected', finalized_poll_id
        using errcode = '23514';
    end if;
  end if;

  if new.title is distinct from old.title
     or new.summary is distinct from old.summary
     or new.requested_minor is distinct from old.requested_minor
     or new.currency is distinct from old.currency
     or new.location is distinct from old.location
     or new.schedule is distinct from old.schedule
     or new.personnel is distinct from old.personnel
     or new.event_flow is distinct from old.event_flow then
    if old.status = 'submitted' and new.status = old.status then
      -- intake text stays editable while the proposal is still a draft
      if new.version <> old.version
         or new.effective_revision_id is distinct from old.effective_revision_id then
        raise exception 'editing a submitted proposal does not create a recorded version'
          using errcode = '23514';
      end if;
    else
      revision_id := new.effective_revision_id;
      if revision_id is null then
        raise exception 'changing recorded proposal content applies a recorded revision'
          using errcode = 'restrict_violation';
      end if;

      select proposal_id, version, changed_fields, title, summary, requested_minor, currency,
             location, schedule, personnel, event_flow, approved_by_contact_id
        into revision_proposal_id, revision_version, revision_fields, revision_title, revision_summary,
             revision_requested_minor, revision_currency, revision_location, revision_schedule,
             revision_personnel, revision_event_flow, revision_approved_by
        from public.{p}rein_mvp_proposal_revisions
       where id = revision_id;
      if not found then
        raise exception 'revision % does not exist', revision_id
          using errcode = '23503';
      end if;

      if revision_proposal_id <> new.id then
        raise exception 'revision % does not belong to proposal %', revision_id, new.id
          using errcode = '23514';
      end if;

      if cardinality(revision_fields) = 0 then
        raise exception 'a comment is not a revision and cannot change a recorded proposal'
          using errcode = '23514';
      end if;

      if revision_version is not null then
        raise exception 'revision % already became version % of proposal %', revision_id, revision_version, new.id
          using errcode = '23514';
      end if;

      -- The applied row must move exactly the fields the revision named, so a
      -- review cannot record one field and quietly change another.
      if ('title' = any(revision_fields)) <> (new.title is distinct from old.title)
         or ('summary' = any(revision_fields)) <> (new.summary is distinct from old.summary)
         or ('budget' = any(revision_fields)) <> (new.requested_minor is distinct from old.requested_minor
                                                  or new.currency is distinct from old.currency)
         or ('location' = any(revision_fields)) <> (new.location is distinct from old.location)
         or ('schedule' = any(revision_fields)) <> (new.schedule is distinct from old.schedule)
         or ('personnel' = any(revision_fields)) <> (new.personnel is distinct from old.personnel)
         or ('event_flow' = any(revision_fields)) <> (new.event_flow is distinct from old.event_flow) then
        raise exception 'the applied change does not match the changed fields revision % recorded', revision_id
          using errcode = '23514';
      end if;

      if ('title' = any(revision_fields) and new.title is distinct from revision_title)
         or ('summary' = any(revision_fields) and new.summary is distinct from revision_summary)
         or ('budget' = any(revision_fields)
             and (new.requested_minor is distinct from revision_requested_minor
                  or new.currency is distinct from revision_currency))
         or ('location' = any(revision_fields) and new.location is distinct from revision_location)
         or ('schedule' = any(revision_fields) and new.schedule is distinct from revision_schedule)
         or ('personnel' = any(revision_fields) and new.personnel is distinct from revision_personnel)
         or ('event_flow' = any(revision_fields) and new.event_flow is distinct from revision_event_flow) then
        raise exception 'the applied content does not match revision %', revision_id
          using errcode = '23514';
      end if;

      -- Material changes need a recorded approval from a director who is
      -- current now. A wording-only revision to title or summary is minor and
      -- stays applicable without one.
      if revision_fields && material_field_names
         and (revision_approved_by is null
              or not public.{p}rein_mvp_is_current_director(revision_approved_by)) then
        raise exception 'revision % changes budget, location, schedule, personnel composition, or event flow without a recorded approval from a current director', revision_id
          using errcode = '23514';
      end if;

      -- The revision takes the version it produced, so the chain of prior
      -- versions stays complete while the caller never numbers one.
      update public.{p}rein_mvp_proposal_revisions
         set version = old.version + 1
       where id = revision_id
         and version is null;
      if not found then
        raise exception 'revision % is no longer applicable', revision_id
          using errcode = '23514';
      end if;
      new.version := old.version + 1;
    end if;
  elsif new.effective_revision_id is distinct from old.effective_revision_id
        or new.version <> old.version then
    raise exception 'a new proposal version requires a recorded revision that changes the proposal content'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$template$;

  proposals_origin_template text := $template$
begin
  -- Version 1 of a proposal is the content it was submitted with, recorded as
  -- the first row of its revision chain so later versions have a predecessor.
  -- This runs as an after-insert trigger, so the revision guard sees trigger
  -- depth 2 and takes intake as its one exemption from the selected-only gate.
  -- A caller reaching the table directly is only one deep and gets no such
  -- exemption.
  insert into public.{p}rein_mvp_proposal_revisions(
    proposal_id, version, author_contact_id, changed_fields,
    title, summary, requested_minor, currency, location, schedule, personnel, event_flow)
  values (
    new.id,
    1,
    new.proposer_contact_id,
    array(
      select field_name
        from unnest(array['title', 'summary', 'budget', 'location', 'schedule',
                          'personnel', 'event_flow']::text[]) as field(field_name)
       where case field_name
               when 'title' then new.title is not null
               when 'summary' then new.summary is not null
               when 'budget' then new.requested_minor is not null
               when 'location' then new.location is not null
               when 'schedule' then new.schedule is not null
               when 'personnel' then new.personnel is not null
               when 'event_flow' then new.event_flow is not null
             end
       order by array_position(array['title', 'summary', 'budget', 'location', 'schedule',
                                    'personnel', 'event_flow']::text[], field_name)
    ),
    new.title,
    new.summary,
    new.requested_minor,
    new.currency,
    new.location,
    new.schedule,
    new.personnel,
    new.event_flow);
  return null;
end;
$template$;

  revisions_write_template text := $template$
declare
  revision_status text;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'recorded proposal feedback is append-only and is not deleted'
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id
       or new.proposal_id <> old.proposal_id
       or new.author_contact_id <> old.author_contact_id
       or new.changed_fields <> old.changed_fields
       or new.title is distinct from old.title
       or new.summary is distinct from old.summary
       or new.requested_minor is distinct from old.requested_minor
       or new.currency is distinct from old.currency
       or new.location is distinct from old.location
       or new.schedule is distinct from old.schedule
       or new.personnel is distinct from old.personnel
       or new.event_flow is distinct from old.event_flow
       or new.note is distinct from old.note
       or new.recorded_at <> old.recorded_at then
      raise exception 'recorded proposal feedback is append-only; only its approval and its effective version are recorded'
        using errcode = 'restrict_violation';
    end if;

    if new.approved_by_contact_id is distinct from old.approved_by_contact_id then
      if old.approved_by_contact_id is not null or new.approved_by_contact_id is null then
        raise exception 'a recorded approval of revision % is final', new.id
          using errcode = 'restrict_violation';
      end if;
      if not public.{p}rein_mvp_is_current_director(new.approved_by_contact_id) then
        raise exception 'approving contact % is not a current director', new.approved_by_contact_id
          using errcode = '23514';
      end if;
      new.approved_at := coalesce(new.approved_at, now());
    elsif new.approved_at is distinct from old.approved_at then
      raise exception 'a recorded approval of revision % is final', new.id
        using errcode = 'restrict_violation';
    end if;

    if new.version is distinct from old.version then
      if old.version is not null or new.version is null or cardinality(new.changed_fields) = 0 then
        raise exception 'revision % records its effective version once, when it is applied', new.id
          using errcode = 'restrict_violation';
      end if;
    end if;

    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('{p}rein_mvp_proposal_revisions:' || new.proposal_id::text, 0));

  -- Feedback is the post-result path: only a proposal whose poll recorded it
  -- as the winner is selected, and only a selected proposal takes new comments
  -- or suggested revisions. An unselected or withdrawn proposal keeps its
  -- record and its feedback history and gains no new feedback.
  --
  -- Version 1 of a proposal is the content it was submitted with, so intake is
  -- the one exemption. Intake is written by the proposal's own after-insert
  -- trigger (rein_mvp_proposals_record_origin), so this guard is one trigger
  -- deep while it records the submitted content and one deep when a caller
  -- reaches the table directly: pg_trigger_depth() is 2 for intake and 1 for
  -- every caller. A caller cannot raise that counter, so the exemption cannot
  -- be borrowed by supplying version 1 by hand, and a proposal keeps only the
  -- version-1 row it was born with.
  if pg_trigger_depth() < 2 then
    select proposal.status
      into revision_status
      from public.{p}rein_mvp_proposals as proposal
     where proposal.id = new.proposal_id;
    if not found then
      raise exception 'feedback names proposal % which does not exist', new.proposal_id
        using errcode = '23503';
    end if;

    if revision_status <> 'selected' then
      raise exception 'post-result feedback is accepted only on a selected proposal, not on proposal % with status %',
          new.proposal_id, revision_status
        using errcode = '23514';
    end if;
  end if;

  if cardinality(new.changed_fields) <> cardinality(array(
       select distinct field_name
         from unnest(new.changed_fields) as field(field_name))) then
    raise exception 'changed fields are named once each'
      using errcode = '23514';
  end if;

  perform 1 from public.{p}community_contacts where id = new.author_contact_id;
  if not found then
    raise exception 'feedback author % has no community contact record', new.author_contact_id
      using errcode = '23503';
  end if;

  if not (
    public.{p}rein_mvp_is_current_director(new.author_contact_id)
    or exists (
      select 1
        from public.{p}contributors as contributor
       where contributor.contact_id = new.author_contact_id
         and contributor.status = 'active'
    )
  ) then
    raise exception 'feedback author % is neither a current director nor an active Contributor', new.author_contact_id
      using errcode = '23514';
  end if;

  if new.version is not null
     and not (
       new.version = 1
       and not exists (
         select 1
           from public.{p}rein_mvp_proposal_revisions as recorded
          where recorded.proposal_id = new.proposal_id
       )
     ) then
    raise exception 'revision % takes its version when it becomes the effective version, not when it is recorded', new.id
      using errcode = '23514';
  end if;

  if new.approved_by_contact_id is not null then
    if not public.{p}rein_mvp_is_current_director(new.approved_by_contact_id) then
      raise exception 'approving contact % is not a current director', new.approved_by_contact_id
        using errcode = '23514';
    end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  new.recorded_at := coalesce(new.recorded_at, now());
  return new;
end;
$template$;

  polls_insert_template text := $template$
declare
  rule_max_candidates integer;
  rule_max_approvals integer;
  candidate_count integer;
  known_count integer;
  typed_count integer;
  eligible_count integer;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('{p}rein_mvp_polls', 0));

  select max_candidates, max_approvals_per_voter
    into rule_max_candidates, rule_max_approvals
    from public.{p}rein_mvp_vote_types
   where vote_type = new.vote_type;
  if not found then
    raise exception 'vote type % is not configured in {p}rein_mvp_vote_types', new.vote_type
      using errcode = '23503';
  end if;

  new.candidate_limit := rule_max_candidates;
  new.max_approvals_per_voter := rule_max_approvals;

  candidate_count := cardinality(new.candidate_proposal_ids);
  if candidate_count <> cardinality(array(select distinct c from unnest(new.candidate_proposal_ids) as t(c))) then
    raise exception 'poll candidates must be unique'
      using errcode = '23514';
  end if;

  if candidate_count > new.candidate_limit then
    raise exception 'vote type % allows at most % candidates per poll', new.vote_type, new.candidate_limit
      using errcode = '23514';
  end if;

  select count(*)
    into known_count
    from public.{p}rein_mvp_proposals
   where id = any(new.candidate_proposal_ids);
  if known_count <> candidate_count then
    raise exception 'every poll candidate must be an existing proposal'
      using errcode = '23503';
  end if;

  select count(*)
    into typed_count
    from public.{p}rein_mvp_proposals
   where id = any(new.candidate_proposal_ids)
     and vote_type = new.vote_type;
  if typed_count <> candidate_count then
    raise exception 'every poll candidate must carry the poll vote type %', new.vote_type
      using errcode = '23514';
  end if;

  select count(*)
    into eligible_count
    from public.{p}rein_mvp_proposals
   where id = any(new.candidate_proposal_ids)
     and status in ('submitted', 'unselected');
  if eligible_count <> candidate_count then
    raise exception 'only submitted or unselected proposals may enter a new poll'
      using errcode = '23514';
  end if;

  perform 1
    from public.{p}rein_mvp_polls as open_poll
   where open_poll.status = 'open'
     and open_poll.candidate_proposal_ids && new.candidate_proposal_ids;
  if found then
    raise exception 'a candidate of this poll is already on an open poll'
      using errcode = '23514';
  end if;

  if not public.{p}rein_mvp_is_current_director(new.creator_contact_id) then
    raise exception 'poll creator % is not a current director', new.creator_contact_id
      using errcode = '23514';
  end if;

  return new;
end;
$template$;

  polls_freeze_template text := $template$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'polls are not deleted; record status cancelled instead'
      using errcode = 'restrict_violation';
  end if;

  if new.id <> old.id
     or new.creator_contact_id <> old.creator_contact_id
     or new.title <> old.title
     or new.vote_type <> old.vote_type
     or new.candidate_proposal_ids <> old.candidate_proposal_ids
     or new.candidate_limit <> old.candidate_limit
     or new.max_approvals_per_voter <> old.max_approvals_per_voter
     or new.opens_at <> old.opens_at
     or new.closes_at <> old.closes_at
     or new.created_at <> old.created_at then
    raise exception 'a recorded poll keeps its candidates, limits, and window; only status may change'
      using errcode = 'restrict_violation';
  end if;

  if new.status <> old.status then
    -- A poll either runs its window out and is closed by finalizing it, or it
    -- is cancelled early. Nothing else moves the status, so no caller can shut
    -- a poll before its deadline and strand the remaining voters.
    if old.status = 'open' and new.status = 'cancelled' then
      null;
    elsif old.status = 'open' and new.status = 'closed'
          and now() >= old.closes_at
          and coalesce(current_setting('rein_mvp.finalize_poll_id', true), '') = old.id::text then
      null;
    else
      raise exception 'poll status cannot move from % to %', old.status, new.status
        using errcode = '23514';
    end if;
  end if;

  if new.finalized_at is distinct from old.finalized_at
     or new.finalized_by_contact_id is distinct from old.finalized_by_contact_id
     or new.winning_proposal_id is distinct from old.winning_proposal_id then
    if old.status <> 'closed' or old.finalized_at is not null then
      raise exception 'poll % records its outcome once, and only after it is closed', old.id
        using errcode = 'restrict_violation';
    end if;

    if coalesce(current_setting('rein_mvp.finalize_poll_id', true), '') <> old.id::text then
      raise exception 'poll outcomes are recorded only by rein_mvp_finalize_poll'
        using errcode = 'restrict_violation';
    end if;

    if new.finalized_at is null or new.finalized_by_contact_id is null then
      raise exception 'a recorded poll outcome names the director who finalized it'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$template$;

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

  ballots_freeze_template text := $template$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  raise exception 'a recorded ballot cannot be replaced or removed'
    using errcode = 'restrict_violation';
end;
$template$;

  vote_types_write_template text := $template$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  new.updated_at := now();
  return new;
end;
$template$;

  poll_winner_template text := $template$
with tally as (
  select ballot_approval.candidate_id, count(*) as approvals
    from public.{p}rein_mvp_ballots as ballot,
         unnest(ballot.approved_proposal_ids) as ballot_approval(candidate_id)
   where ballot.poll_id = p_poll_id
   group by ballot_approval.candidate_id
)
select tally.candidate_id
  from tally
 where tally.approvals = (select max(peer.approvals) from tally as peer)
   and (select count(*) from tally as peer where peer.approvals = tally.approvals) = 1;
$template$;

  finalize_poll_template text := $template$
declare
  poll_status text;
  poll_finalized_at timestamptz;
  poll_finalized_by uuid;
  poll_closes_at timestamptz;
  poll_candidates uuid[];
  leading_proposal_id uuid;
  leading_status text;
  recorded integer := 0;
  ballot_count integer;
  abstention_count integer;
  approvals jsonb;
  repeated boolean := false;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  if p_actor_contact_id is null
     or not public.{p}rein_mvp_is_current_director(p_actor_contact_id) then
    raise exception 'finalizing contact % is not a current director', p_actor_contact_id
      using errcode = '23514';
  end if;

  select poll.status, poll.finalized_at, poll.finalized_by_contact_id, poll.closes_at,
         poll.candidate_proposal_ids, poll.winning_proposal_id
    into poll_status, poll_finalized_at, poll_finalized_by, poll_closes_at,
         poll_candidates, leading_proposal_id
    from public.{p}rein_mvp_polls as poll
   where poll.id = p_poll_id
     for update;
  if not found then
    raise exception 'poll % does not exist', p_poll_id
      using errcode = '23503';
  end if;

  if poll_finalized_at is not null then
    -- Finalizing twice returns the recorded outcome instead of counting a
    -- second time.
    repeated := true;
  else
    if poll_status = 'cancelled' then
      raise exception 'cancelled poll % carries no outcome', p_poll_id
        using errcode = '23514';
    end if;

    -- The window must have run out: ballots are only accepted before
    -- closes_at, and closing the poll is what freezes the ballot set.
    if now() < poll_closes_at then
      raise exception 'poll % stays open until %, and records no outcome before then', p_poll_id, poll_closes_at
        using errcode = '23514';
    end if;

    perform set_config('rein_mvp.finalize_poll_id', p_poll_id::text, true);
    perform set_config('rein_mvp.finalize_actor', p_actor_contact_id::text, true);

    if poll_status = 'open' then
      update public.{p}rein_mvp_polls set status = 'closed' where id = p_poll_id;
      poll_status := 'closed';
    end if;

    -- The winner is the single candidate with the strictly highest approval
    -- count. A tie between the leading candidates, a poll with no approval at
    -- all, and a poll whose every ballot abstained all leave this null, and a
    -- null winner never becomes 'selected'.
    leading_proposal_id := public.{p}rein_mvp_poll_winner(p_poll_id);

    if leading_proposal_id is not null then
      select proposal.status
        into leading_status
        from public.{p}rein_mvp_proposals as proposal
       where proposal.id = leading_proposal_id;
      if leading_status not in ('submitted', 'unselected') then
        raise exception 'the leading proposal % of poll % is % and can no longer be selected',
          leading_proposal_id, p_poll_id, leading_status
          using errcode = '23514';
      end if;
    end if;

    update public.{p}rein_mvp_proposals as proposal
       set status = case when proposal.id = leading_proposal_id then 'selected' else 'unselected' end
     where proposal.id = any(poll_candidates)
       and proposal.status in ('submitted', 'unselected')
       and proposal.status <> case when proposal.id = leading_proposal_id then 'selected' else 'unselected' end;
    get diagnostics recorded = row_count;

    update public.{p}rein_mvp_polls
       set finalized_at = now(),
           finalized_by_contact_id = p_actor_contact_id,
           winning_proposal_id = leading_proposal_id
     where id = p_poll_id;
  end if;

  select count(*), count(*) filter (where cardinality(ballot.approved_proposal_ids) = 0)
    into ballot_count, abstention_count
    from public.{p}rein_mvp_ballots as ballot
   where ballot.poll_id = p_poll_id;

  select coalesce(
           jsonb_object_agg(tally.candidate_id::text, tally.approvals order by tally.approvals desc),
           '{}'::jsonb)
    into approvals
    from (
      select ballot_approval.candidate_id, count(*) as approvals
        from public.{p}rein_mvp_ballots as ballot,
             unnest(ballot.approved_proposal_ids) as ballot_approval(candidate_id)
       where ballot.poll_id = p_poll_id
       group by ballot_approval.candidate_id
    ) as tally;

  return jsonb_build_object(
    'poll_id', p_poll_id,
    'status', poll_status,
    'repeated', repeated,
    'outcome', case when leading_proposal_id is null then 'no_winner' else 'winner' end,
    'winning_proposal_id', leading_proposal_id,
    'finalized_by_contact_id', coalesce(poll_finalized_by, p_actor_contact_id),
    'candidates', to_jsonb(poll_candidates),
    'proposals_recorded', recorded,
    'ballots', ballot_count,
    'abstentions', abstention_count,
    'approvals', approvals);
end;
$template$;

  approve_revision_template text := $template$
declare
  updated integer;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Rein MVP governance rejects writes from the Data API role %', current_user
      using errcode = '42501';
  end if;

  if p_approver_contact_id is null
     or not public.{p}rein_mvp_is_current_director(p_approver_contact_id) then
    raise exception 'approving contact % is not a current director', p_approver_contact_id
      using errcode = '23514';
  end if;

  update public.{p}rein_mvp_proposal_revisions
     set approved_by_contact_id = p_approver_contact_id,
         approved_at = now()
   where id = p_revision_id
     and approved_by_contact_id is null;
  get diagnostics updated = row_count;

  if updated <> 1 then
    raise exception 'revision % does not exist or already carries an approval', p_revision_id
      using errcode = '23514';
  end if;
end;
$template$;

  is_director_template text := $template$
select exists (
  select 1
    from public.{p}people as person
   where person.person_type = 'director'
     and (
       person.contact_id = p_contact_id
       or exists (
         select 1
           from public.{p}contributors as contributor
          where contributor.id = person.contributor_id
            and contributor.contact_id = p_contact_id
       )
     )
);
$template$;
begin
  foreach prefix in array array['dev_', 'prod_'] loop
    execute format($ddl$
      create table if not exists public.%I (
        vote_type text primary key,
        max_candidates integer not null,
        max_approvals_per_voter integer not null,
        updated_at timestamptz not null default now(),
        constraint %I check (vote_type = lower(btrim(vote_type)) and vote_type ~ '^[a-z][a-z0-9_]{0,63}$'),
        constraint %I check (max_candidates >= 1),
        constraint %I check (max_approvals_per_voter >= 1 and max_approvals_per_voter <= max_candidates)
      )
    $ddl$,
      prefix || 'rein_mvp_vote_types',
      prefix || 'rein_mvp_vote_types_type_check',
      prefix || 'rein_mvp_vote_types_candidates_check',
      prefix || 'rein_mvp_vote_types_approvals_check');

    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        proposer_contact_id uuid not null references public.%I(id) on delete restrict,
        title text not null,
        summary text,
        vote_type text not null references public.%I(vote_type) on delete restrict,
        requested_minor integer,
        currency text,
        location text,
        schedule text,
        personnel text,
        event_flow text,
        status text not null default 'submitted',
        version integer not null default 1,
        effective_revision_id uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %I check (length(btrim(title)) between 1 and 200),
        constraint %I check (requested_minor is null or requested_minor >= 0),
        constraint %I check (currency is null or currency ~ '^[A-Z]{3}$'),
        constraint %I check ((requested_minor is null) = (currency is null)),
        constraint %I check (status in ('submitted', 'selected', 'unselected', 'withdrawn')),
        constraint %I check (version >= 1)
      )
    $ddl$,
      prefix || 'rein_mvp_proposals',
      prefix || 'community_contacts',
      prefix || 'rein_mvp_vote_types',
      prefix || 'rein_mvp_proposals_title_check',
      prefix || 'rein_mvp_proposals_requested_check',
      prefix || 'rein_mvp_proposals_currency_check',
      prefix || 'rein_mvp_proposals_amount_currency_check',
      prefix || 'rein_mvp_proposals_status_check',
      prefix || 'rein_mvp_proposals_version_check');

    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        creator_contact_id uuid not null references public.%I(id) on delete restrict,
        title text not null,
        vote_type text not null references public.%I(vote_type) on delete restrict,
        candidate_proposal_ids uuid[] not null,
        candidate_limit integer not null,
        max_approvals_per_voter integer not null,
        status text not null default 'open',
        opens_at timestamptz not null,
        closes_at timestamptz not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        finalized_at timestamptz,
        finalized_by_contact_id uuid references public.%I(id) on delete restrict,
        winning_proposal_id uuid references public.%I(id) on delete restrict,
        constraint %I check (length(btrim(title)) between 1 and 200),
        constraint %I check (closes_at > opens_at),
        constraint %I check (cardinality(candidate_proposal_ids) >= 1
          and array_position(candidate_proposal_ids, null) is null),
        constraint %I check (candidate_limit >= 1),
        constraint %I check (max_approvals_per_voter >= 1 and max_approvals_per_voter <= candidate_limit),
        constraint %I check (status in ('open', 'closed', 'cancelled'))
      )
    $ddl$,
      prefix || 'rein_mvp_polls',
      prefix || 'community_contacts',
      prefix || 'rein_mvp_vote_types',
      prefix || 'community_contacts',
      prefix || 'rein_mvp_proposals',
      prefix || 'rein_mvp_polls_title_check',
      prefix || 'rein_mvp_polls_window_check',
      prefix || 'rein_mvp_polls_candidates_check',
      prefix || 'rein_mvp_polls_candidate_limit_check',
      prefix || 'rein_mvp_polls_approvals_check',
      prefix || 'rein_mvp_polls_status_check');

    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        poll_id uuid not null references public.%I(id) on delete restrict,
        voter_contact_id uuid not null references public.%I(id) on delete restrict,
        approved_proposal_ids uuid[] not null default '{}'::uuid[],
        cast_at timestamptz not null default now(),
        constraint %I check (array_position(approved_proposal_ids, null) is null),
        constraint %I unique (poll_id, voter_contact_id)
      )
    $ddl$,
      prefix || 'rein_mvp_ballots',
      prefix || 'rein_mvp_polls',
      prefix || 'community_contacts',
      prefix || 'rein_mvp_ballots_approved_check',
      prefix || 'rein_mvp_ballots_one_per_voter_key');

    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        proposal_id uuid not null references public.%I(id) on delete restrict,
        version integer,
        author_contact_id uuid not null references public.%I(id) on delete restrict,
        changed_fields text[] not null default '{}'::text[],
        title text,
        summary text,
        requested_minor integer,
        currency text,
        location text,
        schedule text,
        personnel text,
        event_flow text,
        note text,
        approved_by_contact_id uuid references public.%I(id) on delete restrict,
        approved_at timestamptz,
        recorded_at timestamptz not null default now(),
        constraint %I check (version is null or version >= 1),
        constraint %I check (array_position(changed_fields, null) is null),
        constraint %I check (changed_fields <@ array[
          'title', 'summary', 'budget', 'location', 'schedule', 'personnel', 'event_flow']::text[]),
        constraint %I check (cardinality(changed_fields) > 0 or version is null),
        constraint %I check (cardinality(changed_fields) > 0
          or (note is not null and length(btrim(note)) between 1 and 2000)),
        constraint %I check (('title' = any(changed_fields)) = (title is not null)),
        constraint %I check (title is null or length(btrim(title)) between 1 and 200),
        constraint %I check (('summary' = any(changed_fields)) = (summary is not null)),
        constraint %I check (('budget' = any(changed_fields))
          = (requested_minor is not null and currency is not null)),
        constraint %I check (requested_minor is null or requested_minor >= 0),
        constraint %I check (currency is null or currency ~ '^[A-Z]{3}$'),
        constraint %I check (('location' = any(changed_fields)) = (location is not null)),
        constraint %I check (('schedule' = any(changed_fields)) = (schedule is not null)),
        constraint %I check (('personnel' = any(changed_fields)) = (personnel is not null)),
        constraint %I check (('event_flow' = any(changed_fields)) = (event_flow is not null)),
        constraint %I check ((approved_by_contact_id is null) = (approved_at is null)),
        constraint %I unique (proposal_id, version)
      )
    $ddl$,
      prefix || 'rein_mvp_proposal_revisions',
      prefix || 'rein_mvp_proposals',
      prefix || 'community_contacts',
      prefix || 'community_contacts',
      prefix || 'rein_mvp_revisions_version_check',
      prefix || 'rein_mvp_revisions_fields_position_check',
      prefix || 'rein_mvp_revisions_fields_check',
      prefix || 'rein_mvp_revisions_comment_version_check',
      prefix || 'rein_mvp_revisions_note_check',
      prefix || 'rein_mvp_revisions_title_check',
      prefix || 'rein_mvp_revisions_title_length_check',
      prefix || 'rein_mvp_revisions_summary_check',
      prefix || 'rein_mvp_revisions_budget_check',
      prefix || 'rein_mvp_revisions_requested_check',
      prefix || 'rein_mvp_revisions_currency_check',
      prefix || 'rein_mvp_revisions_location_check',
      prefix || 'rein_mvp_revisions_schedule_check',
      prefix || 'rein_mvp_revisions_personnel_check',
      prefix || 'rein_mvp_revisions_event_flow_check',
      prefix || 'rein_mvp_revisions_approval_pair_check',
      prefix || 'rein_mvp_revisions_version_key');

    -- The phase-two tables may already exist, so every column this migration
    -- adds to them is also declared on its own.
    execute format('alter table public.%I add column if not exists version integer not null default 1',
      prefix || 'rein_mvp_proposals');
    execute format('alter table public.%I add column if not exists effective_revision_id uuid',
      prefix || 'rein_mvp_proposals');
    execute format('alter table public.%I add column if not exists location text',
      prefix || 'rein_mvp_proposals');
    execute format('alter table public.%I add column if not exists schedule text',
      prefix || 'rein_mvp_proposals');
    execute format('alter table public.%I add column if not exists personnel text',
      prefix || 'rein_mvp_proposals');
    execute format('alter table public.%I add column if not exists event_flow text',
      prefix || 'rein_mvp_proposals');
    execute format('alter table public.%I add column if not exists finalized_at timestamptz',
      prefix || 'rein_mvp_polls');
    execute format('alter table public.%I add column if not exists finalized_by_contact_id uuid',
      prefix || 'rein_mvp_polls');
    execute format('alter table public.%I add column if not exists winning_proposal_id uuid',
      prefix || 'rein_mvp_polls');

    -- The effective revision points back at the table that points here, so
    -- the foreign key is added once both tables exist.
    if not exists (
      select 1
        from pg_constraint
       where conname = prefix || 'rein_mvp_proposals_effective_revision_fkey'
         and conrelid = (quote_ident('public') || '.' || quote_ident(prefix || 'rein_mvp_proposals'))::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (effective_revision_id) references public.%I(id) on delete restrict',
        prefix || 'rein_mvp_proposals', prefix || 'rein_mvp_proposals_effective_revision_fkey',
        prefix || 'rein_mvp_proposal_revisions');
    end if;

    execute format('create index if not exists %I on public.%I(proposer_contact_id)',
      prefix || 'rein_mvp_proposals_proposer_idx', prefix || 'rein_mvp_proposals');
    execute format('create index if not exists %I on public.%I(vote_type, status)',
      prefix || 'rein_mvp_proposals_type_status_idx', prefix || 'rein_mvp_proposals');
    execute format('create index if not exists %I on public.%I(status, created_at desc)',
      prefix || 'rein_mvp_proposals_status_created_idx', prefix || 'rein_mvp_proposals');
    execute format('create index if not exists %I on public.%I(vote_type, status)',
      prefix || 'rein_mvp_polls_type_status_idx', prefix || 'rein_mvp_polls');
    execute format('create index if not exists %I on public.%I(closes_at)',
      prefix || 'rein_mvp_polls_closes_idx', prefix || 'rein_mvp_polls');
    execute format('create index if not exists %I on public.%I(poll_id, cast_at)',
      prefix || 'rein_mvp_ballots_poll_idx', prefix || 'rein_mvp_ballots');
    execute format('create index if not exists %I on public.%I(voter_contact_id)',
      prefix || 'rein_mvp_ballots_voter_idx', prefix || 'rein_mvp_ballots');
    execute format('create index if not exists %I on public.%I(proposal_id, version)',
      prefix || 'rein_mvp_revisions_proposal_idx', prefix || 'rein_mvp_proposal_revisions');
    execute format('create index if not exists %I on public.%I(proposal_id, recorded_at)',
      prefix || 'rein_mvp_revisions_recorded_idx', prefix || 'rein_mvp_proposal_revisions');

    execute format(
      'create or replace function public.%I(p_contact_id uuid) returns boolean language sql stable set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_is_current_director', replace(is_director_template, '{p}', prefix));
    execute format('revoke all on function public.%I(uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_is_current_director');
    execute format('grant execute on function public.%I(uuid) to service_role',
      prefix || 'rein_mvp_is_current_director');

    execute format(
      'create or replace function public.%I(p_poll_id uuid) returns uuid language sql stable set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_poll_winner', replace(poll_winner_template, '{p}', prefix));
    execute format('revoke all on function public.%I(uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_poll_winner');
    execute format('grant execute on function public.%I(uuid) to service_role',
      prefix || 'rein_mvp_poll_winner');

    execute format(
      'create or replace function public.%I(p_poll_id uuid, p_actor_contact_id uuid) returns jsonb language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_finalize_poll', replace(finalize_poll_template, '{p}', prefix));
    execute format('revoke all on function public.%I(uuid, uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_finalize_poll');
    execute format('grant execute on function public.%I(uuid, uuid) to service_role',
      prefix || 'rein_mvp_finalize_poll');

    execute format(
      'create or replace function public.%I(p_revision_id uuid, p_approver_contact_id uuid) returns void language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_approve_revision', replace(approve_revision_template, '{p}', prefix));
    execute format('revoke all on function public.%I(uuid, uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_approve_revision');
    execute format('grant execute on function public.%I(uuid, uuid) to service_role',
      prefix || 'rein_mvp_approve_revision');

    body := replace(proposals_write_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_proposals_before_write', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_proposals_before_write');

    body := replace(polls_insert_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_polls_before_insert', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_polls_before_insert');

    body := replace(polls_freeze_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_polls_before_update', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_polls_before_update');

    body := replace(ballots_insert_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_ballots_before_insert', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_ballots_before_insert');

    body := replace(ballots_freeze_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_ballots_before_update', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_ballots_before_update');

    body := replace(vote_types_write_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_vote_types_before_write', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_vote_types_before_write');

    body := replace(revisions_write_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_revisions_before_write', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_revisions_before_write');

    body := replace(proposals_origin_template, '{p}', prefix);
    execute format(
      'create or replace function public.%I() returns trigger language plpgsql set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_proposals_record_origin', body);
    execute format('revoke all on function public.%I() from public, anon, authenticated',
      prefix || 'rein_mvp_proposals_record_origin');

    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_vote_types_before_write', prefix || 'rein_mvp_vote_types');
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_vote_types_before_write', prefix || 'rein_mvp_vote_types',
      prefix || 'rein_mvp_vote_types_before_write');

    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_proposals_before_write', prefix || 'rein_mvp_proposals');
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_proposals_before_write', prefix || 'rein_mvp_proposals',
      prefix || 'rein_mvp_proposals_before_write');

    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_polls_before_insert', prefix || 'rein_mvp_polls');
    execute format('create trigger %I before insert on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_polls_before_insert', prefix || 'rein_mvp_polls',
      prefix || 'rein_mvp_polls_before_insert');
    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_polls_before_update', prefix || 'rein_mvp_polls');
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_polls_before_update', prefix || 'rein_mvp_polls',
      prefix || 'rein_mvp_polls_before_update');

    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_ballots_before_insert', prefix || 'rein_mvp_ballots');
    execute format('create trigger %I before insert on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_ballots_before_insert', prefix || 'rein_mvp_ballots',
      prefix || 'rein_mvp_ballots_before_insert');
    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_ballots_before_update', prefix || 'rein_mvp_ballots');
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_ballots_before_update', prefix || 'rein_mvp_ballots',
      prefix || 'rein_mvp_ballots_before_update');

    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_proposals_record_origin', prefix || 'rein_mvp_proposals');
    execute format('create trigger %I after insert on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_proposals_record_origin', prefix || 'rein_mvp_proposals',
      prefix || 'rein_mvp_proposals_record_origin');

    execute format('drop trigger if exists %I on public.%I',
      prefix || 'rein_mvp_revisions_before_write', prefix || 'rein_mvp_proposal_revisions');
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.%I()',
      prefix || 'rein_mvp_revisions_before_write', prefix || 'rein_mvp_proposal_revisions',
      prefix || 'rein_mvp_revisions_before_write');

    foreach table_name in array environment_tables loop
      table_name := prefix || table_name;
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
      execute format('grant all privileges on table public.%I to service_role', table_name);
    end loop;
  end loop;
end;
$rein_mvp_phase_two$;

notify pgrst, 'reload schema';

commit;
