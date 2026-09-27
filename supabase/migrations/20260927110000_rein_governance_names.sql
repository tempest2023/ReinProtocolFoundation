-- Rein governance: drop the stage-specific "mvp" from the long-term names.
--
-- The governance row stores (tables, indexes, constraints) and the two public
-- RPCs were created with an "mvp" segment that described the phase of the
-- project rather than the thing itself. Every remaining reference to "mvp" in
-- a schema object name is a name that would have to be carried forever, so the
-- physical names move now, before launch, while there is nothing but
-- development data behind them.
--
-- What this migration does, per environment prefix (dev_, prod_), inside one
-- transaction:
--
--   1. Renames the five physical tables
--        <e>rein_mvp_vote_types           -> <e>rein_vote_types
--        <e>rein_mvp_proposals            -> <e>rein_proposals
--        <e>rein_mvp_polls                -> <e>rein_polls
--        <e>rein_mvp_ballots              -> <e>rein_ballots
--        <e>rein_mvp_proposal_revisions   -> <e>rein_proposal_revisions
--      with ALTER TABLE ... RENAME TO. A rename keeps the table OID, so the
--      rows, primary keys, foreign keys, check constraints, indexes, triggers,
--      RLS enablement, and existing grants all move with the table unchanged.
--      No row store is copied, no data is rewritten, and RLS stays on.
--
--   2. Creates a read/write passthrough view under each legacy name
--        <e>rein_mvp_vote_types, ... , <e>rein_mvp_proposal_revisions
--      so the old table route keeps working during the transition. The views
--      are declared WITH (security_invoker = true) so they run with the
--      privileges and RLS context of the caller instead of the view owner,
--      and they are granted only to service_role. The bodies of the existing
--      PL/pgSQL helpers were written against the old names, so the views are
--      also what keeps those un-renamed function bodies working while they are
--      still deployed; the functions that matter are renamed in step 3.
--
--   3. Renames the two public RPCs
--        <e>rein_mvp_finalize_poll    -> <e>rein_finalize_poll
--        <e>rein_mvp_approve_revision -> <e>rein_approve_revision
--      and creates an old-name wrapper for each with the identical parameter
--      names, parameter types, and return type, so an existing caller does not
--      change. The wrappers execute the new function and are granted only to
--      service_role, matching the grants the renamed functions already carry.
--
-- The Data API roles keep no access anywhere: the new table names, both
-- wrappers, and both compatibility views are revoked from public, anon, and
-- authenticated, and only service_role is granted. Revoking from the new names
-- matters even though a rename preserves the old ACL, because the new names
-- are new identifiers that a future default ACL could otherwise expose.
--
-- This is a forward migration: 20260924095705_rein_mvp_proposals_polls_ballots
-- is already applied to the linked project and 20260927103000_rein_mvp_ballot_
-- cast_at_db_clock is committed at 32977bf but not applied there yet. Neither
-- earlier migration is rewritten, so both are left untouched and fresh
-- installs converge here. This migration assumes the 20260927103000 ballot
-- guard is in place, which is true for fresh installs and for any environment
-- that has run the migrations in order.

begin;

do $rein_governance_names$
declare
  prefixes text[] := array['dev_', 'prod_'];
  prefix text;
  renamed_tables constant text[][] := array[
    ['rein_mvp_vote_types',         'rein_vote_types'],
    ['rein_mvp_proposals',          'rein_proposals'],
    ['rein_mvp_polls',              'rein_polls'],
    ['rein_mvp_ballots',            'rein_ballots'],
    ['rein_mvp_proposal_revisions', 'rein_proposal_revisions']
  ];
  -- The legacy names the compatibility views must answer to, in the same
  -- order as the table pairs above.
  legacy_views constant text[] := array[
    'rein_mvp_vote_types',
    'rein_mvp_proposals',
    'rein_mvp_polls',
    'rein_mvp_ballots',
    'rein_mvp_proposal_revisions'
  ];
  old_name text;
  new_name text;
  index integer;
begin
  foreach prefix in array prefixes loop

    -- 1. Move the row stores to their long-term names. A rename preserves the
    --    OID, so rows, constraints, indexes, triggers, RLS, and grants follow
    --    the table without a copy.
    for index in 1 .. array_length(renamed_tables, 1) loop
      old_name := prefix || renamed_tables[index][1];
      new_name := prefix || renamed_tables[index][2];

      if to_regclass(format('public.%I', new_name)) is not null then
        raise exception 'refusing to rename: % already exists', new_name;
      end if;
      if to_regclass(format('public.%I', old_name)) is null then
        raise exception 'expected table % to exist before renaming', old_name;
      end if;

      execute format('alter table public.%I rename to %I', old_name, new_name);

      -- A rename keeps the old ACL; revoke on the new name anyway so the new
      -- identifier is never reachable by a Data API role, then keep the
      -- service_role grant the table already had.
      execute format('revoke all on table public.%I from public, anon, authenticated', new_name);
      execute format('grant all privileges on table public.%I to service_role', new_name);
    end loop;

    -- 2. Keep the old names reachable through security_invoker views so the
    --    existing route and any not-yet-renamed PL/pgSQL body keep working.
    --    select * is intentional here: the view is created now, so it captures
    --    the table's columns as they exist at this moment. A later migration
    --    that changes the underlying columns must recreate this view to match
    --    (the next migration that adds or drops a column and expects the old
    --    route to see it owes that recreate); the point of this view is to
    --    keep the old name working through the rename, not to track the table
    --    forever by itself.
    for index in 1 .. array_length(legacy_views, 1) loop
      old_name := prefix || legacy_views[index];
      new_name := prefix || renamed_tables[index][2];

      execute format('create or replace view public.%I with (security_invoker = true) as select * from public.%I',
        old_name, new_name);

      -- Views default to owner rights for the grant check and are reachable
      -- through the Data API unless revoked; keep them service_role only.
      execute format('revoke all on table public.%I from public, anon, authenticated', old_name);
      execute format('grant select, insert, update, delete on table public.%I to service_role', old_name);
    end loop;

    -- 3. Rename the two public RPCs and keep their old names callable through
    --    wrappers that reproduce the exact signature and return type.
    execute format('alter function public.%I(uuid, uuid) rename to %I',
      prefix || 'rein_mvp_finalize_poll', prefix || 'rein_finalize_poll');
    execute format('revoke all on function public.%I(uuid, uuid) from public, anon, authenticated',
      prefix || 'rein_finalize_poll');
    execute format('grant execute on function public.%I(uuid, uuid) to service_role',
      prefix || 'rein_finalize_poll');

    execute format('alter function public.%I(uuid, uuid) rename to %I',
      prefix || 'rein_mvp_approve_revision', prefix || 'rein_approve_revision');
    execute format('revoke all on function public.%I(uuid, uuid) from public, anon, authenticated',
      prefix || 'rein_approve_revision');
    execute format('grant execute on function public.%I(uuid, uuid) to service_role',
      prefix || 'rein_approve_revision');

    execute format($wrapper$
      create or replace function public.%I(
        p_poll_id uuid,
        p_actor_contact_id uuid)
      returns jsonb
      language sql
      volatile
      set search_path = public, pg_temp
      as $body$
        select public.%I(p_poll_id, p_actor_contact_id);
      $body$
    $wrapper$,
      prefix || 'rein_mvp_finalize_poll',
      prefix || 'rein_finalize_poll');
    execute format('revoke all on function public.%I(uuid, uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_finalize_poll');
    execute format('grant execute on function public.%I(uuid, uuid) to service_role',
      prefix || 'rein_mvp_finalize_poll');

    execute format($wrapper$
      create or replace function public.%I(
        p_revision_id uuid,
        p_approver_contact_id uuid)
      returns void
      language sql
      volatile
      set search_path = public, pg_temp
      as $body$
        select public.%I(p_revision_id, p_approver_contact_id);
      $body$
    $wrapper$,
      prefix || 'rein_mvp_approve_revision',
      prefix || 'rein_approve_revision');
    execute format('revoke all on function public.%I(uuid, uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_approve_revision');
    execute format('grant execute on function public.%I(uuid, uuid) to service_role',
      prefix || 'rein_mvp_approve_revision');

  end loop;
end;
$rein_governance_names$;

notify pgrst, 'reload schema';

commit;
