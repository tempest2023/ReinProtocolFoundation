-- Rein governance: remove the stage-specific name compatibility objects.
--
-- 20260927110000_rein_governance_names moved the governance row stores and the
-- two public RPCs off the stage-specific "mvp" names. To keep an old caller
-- working while that rename landed, the same migration also left two sets of
-- old-name passthroughs behind:
--
--   * ten read/write views, one per environment (dev_, prod_) per governance
--     store, declared WITH (security_invoker = true) and granted to
--     service_role only:
--       <e>rein_mvp_vote_types, <e>rein_mvp_proposals, <e>rein_mvp_polls,
--       <e>rein_mvp_ballots, <e>rein_mvp_proposal_revisions
--   * four SQL wrappers, one per environment per public RPC, carrying the
--     same (uuid, uuid) signature and return type as the renamed function:
--       <e>rein_mvp_finalize_poll(uuid, uuid) returns jsonb
--       <e>rein_mvp_approve_revision(uuid, uuid) returns void
--
-- Rein Protocol is at v0.1 and has never published an MVP-named version, so
-- there is no released caller for the compatibility layer to keep working and
-- no reason to carry fourteen extra names forward. This migration removes it.
-- Nothing else depends on those objects: the only catalog rows that point at a
-- compatibility view are the view's own row type and rewrite rule, which are
-- dropped with it, and no other function body names a "rein_mvp_" object.
--
-- Everything the rename produced stays exactly as it is: the ten long-term
-- physical tables with their constraints, indexes, triggers, RLS enablement,
-- and grants; the twenty helper and trigger functions; and the six long-term
-- RPCs. Dropping a view or a function cannot reach any of them, and no grant
-- is widened here: the Data API roles keep no access they did not already
-- have, and service_role keeps the access it had.
--
-- Both drops are idempotent and schema-qualified, so this migration is safe to
-- run on a database where the compatibility objects were already removed, and
-- it can never reach an object outside public. The verification at the end
-- fails loudly rather than leaving a half-cleaned schema: no old-name view or
-- function may survive, and the ten physical tables and six long-term RPCs
-- must all still be present.

begin;

-- 1. The ten old-name read/write views. Each was created as a passthrough over
--    its long-term table, so dropping it removes only the alias, not any row
--    store: the table behind it, its rows, and its access rules are untouched.
drop view if exists public.dev_rein_mvp_vote_types;
drop view if exists public.dev_rein_mvp_proposals;
drop view if exists public.dev_rein_mvp_polls;
drop view if exists public.dev_rein_mvp_ballots;
drop view if exists public.dev_rein_mvp_proposal_revisions;
drop view if exists public.prod_rein_mvp_vote_types;
drop view if exists public.prod_rein_mvp_proposals;
drop view if exists public.prod_rein_mvp_polls;
drop view if exists public.prod_rein_mvp_ballots;
drop view if exists public.prod_rein_mvp_proposal_revisions;

-- 2. The four old-name RPC wrappers. Each name is given with its full
--    argument list so the drop can only reach the wrapper the rename created,
--    never a differently shaped overload of the same name. Both wrappers were
--    plain delegations to the long-term function, so removing them leaves the
--    governance flow with exactly one implementation of each behavior.
drop function if exists public.dev_rein_mvp_finalize_poll(uuid, uuid);
drop function if exists public.dev_rein_mvp_approve_revision(uuid, uuid);
drop function if exists public.prod_rein_mvp_finalize_poll(uuid, uuid);
drop function if exists public.prod_rein_mvp_approve_revision(uuid, uuid);

-- 3. Assert the removal landed and the long-term objects are intact. The
--    leftover checks are scoped to public and match no name this migration
--    created, so they read the state the drops above actually produced.
do $remove_stage_compatibility_objects$
declare
  leftover_count integer;
  stable_table_count integer;
  stable_rpc_count integer;
begin
  select count(*)
    into leftover_count
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
     and c.relname like '%rein_mvp_%';
  if leftover_count <> 0 then
    raise exception 'expected no old-name governance view in public, found %',
      leftover_count;
  end if;

  select count(*)
    into leftover_count
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like '%rein_mvp_%';
  if leftover_count <> 0 then
    raise exception 'expected no old-name governance function in public, found %',
      leftover_count;
  end if;

  select count(*)
    into stable_table_count
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname in ('dev_rein_vote_types', 'dev_rein_proposals', 'dev_rein_polls',
                       'dev_rein_ballots', 'dev_rein_proposal_revisions',
                       'prod_rein_vote_types', 'prod_rein_proposals', 'prod_rein_polls',
                       'prod_rein_ballots', 'prod_rein_proposal_revisions');
  if stable_table_count <> 10 then
    raise exception 'expected the ten long-term governance tables to survive, found %',
      stable_table_count;
  end if;

  -- RLS stays on for every one of them; a view drop must not have disturbed a
  -- table-level access rule.
  select count(*)
    into stable_table_count
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r'
     and c.relname in ('dev_rein_vote_types', 'dev_rein_proposals', 'dev_rein_polls',
                       'dev_rein_ballots', 'dev_rein_proposal_revisions',
                       'prod_rein_vote_types', 'prod_rein_proposals', 'prod_rein_polls',
                       'prod_rein_ballots', 'prod_rein_proposal_revisions')
     and c.relrowsecurity;
  if stable_table_count <> 10 then
    raise exception 'expected row level security to stay enabled on all ten governance tables, found %',
      stable_table_count;
  end if;

  select count(*)
    into stable_rpc_count
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('dev_rein_finalize_poll', 'dev_rein_approve_revision',
                       'dev_rein_poll_winner', 'prod_rein_finalize_poll',
                       'prod_rein_approve_revision', 'prod_rein_poll_winner');
  if stable_rpc_count <> 6 then
    raise exception 'expected the six long-term governance RPCs to survive, found %',
      stable_rpc_count;
  end if;
end;
$remove_stage_compatibility_objects$;

notify pgrst, 'reload schema';

commit;
