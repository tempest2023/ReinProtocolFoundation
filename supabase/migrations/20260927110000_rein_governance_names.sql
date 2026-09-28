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
--      still deployed; the functions that matter are renamed in steps 3 and 4
--      and their bodies are rebuilt in step 5.
--
--   3. Renames the two public RPCs
--        <e>rein_mvp_finalize_poll    -> <e>rein_finalize_poll
--        <e>rein_mvp_approve_revision -> <e>rein_approve_revision
--      and creates an old-name wrapper for each with the identical parameter
--      names, parameter types, and return type, so an existing caller does not
--      change. The wrappers execute the new function and are granted only to
--      service_role, matching the grants the renamed functions already carry.
--
--   4. Renames the ten helper and trigger functions
--        <e>rein_mvp_is_current_director, <e>rein_mvp_poll_winner,
--        <e>rein_mvp_proposals_before_write, <e>rein_mvp_polls_before_insert,
--        <e>rein_mvp_polls_before_update, <e>rein_mvp_ballots_before_insert,
--        <e>rein_mvp_ballots_before_update, <e>rein_mvp_vote_types_before_write,
--        <e>rein_mvp_revisions_before_write,
--        <e>rein_mvp_proposals_record_origin
--        -> <e>rein_* with ALTER FUNCTION ... RENAME TO. A function rename
--      keeps the OID, so the triggers the earlier migration attached to the
--      renamed tables keep firing the same function and the existing grants
--      move with it.
--
--   5. Recreates every one of the twelve new-name functions from its deployed
--      definition, read back with pg_get_functiondef() and rewritten so that
--      no "rein_mvp" segment survives in the body. Without this the helper and
--      trigger bodies would still route through the step-2 compatibility views
--      and the old setting names, which is the dependency these views exist
--      for; after this step the views are only a caller compatibility shim.
--
--   6. Renames the triggers, constraints, and indexes still attached to the
--      five tables under "rein_mvp" names, because a table rename carries an
--      object to the new table but does not rename the object itself. Each
--      pass is driven by a catalog lookup scoped to these five tables, so an
--      unrelated "rein_mvp_" name elsewhere is left alone. Constraints move
--      before indexes: a primary key or unique constraint owns its backing
--      index and renames it along with itself, so the index pass skips any
--      index a constraint owns. Only names change; no object is rebuilt and
--      no row is read or written.
--
--   7. Asserts the rename landed: no trigger, constraint, or index on the
--      five tables still matches "rein_mvp_". The only old names kept on
--      purpose are the step-2 compatibility views and the step-3 RPC
--      wrappers, which are views and functions rather than catalog objects
--      on the tables, so they fall outside this check.
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
  -- The ten helper and trigger functions the earlier migration created under
  -- the mvp name, without the environment prefix. The two public RPCs are
  -- renamed in step 3 and are folded back in for the step-5 body rebuild.
  helper_functions constant text[] := array[
    'rein_mvp_is_current_director',
    'rein_mvp_poll_winner',
    'rein_mvp_proposals_before_write',
    'rein_mvp_polls_before_insert',
    'rein_mvp_polls_before_update',
    'rein_mvp_ballots_before_insert',
    'rein_mvp_ballots_before_update',
    'rein_mvp_vote_types_before_write',
    'rein_mvp_revisions_before_write',
    'rein_mvp_proposals_record_origin'
  ];
  old_name text;
  new_name text;
  index integer;
  helper_name text;
  new_function_name text;
  renamed_functions text[];
  function_row record;
  function_oid oid;
  function_definition text;
  function_count integer;
  -- Names of the five physical tables after step 1, used to scope the
  -- catalog-driven rename passes below to exactly these tables.
  physical_tables text[];
  object_row record;
  old_object_name text;
  new_object_name text;
  leftover_count integer;
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

    -- 4. Rename the ten helper and trigger functions. The rename keeps the
    --    OID, so the triggers already attached to the renamed tables follow
    --    along and the existing grants stay with the function.
    foreach helper_name in array helper_functions loop
      new_function_name := prefix || replace(helper_name, 'rein_mvp_', 'rein_');

      select p.oid
        into function_oid
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = prefix || helper_name;
      if function_oid is null then
        raise exception 'expected function %.% to exist before renaming',
          'public', prefix || helper_name;
      end if;

      if exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = new_function_name
      ) then
        raise exception 'refusing to rename: % already exists', new_function_name;
      end if;

      execute format('alter function %s rename to %I',
        function_oid::regprocedure, new_function_name);
    end loop;

    -- 5. Rebuild the twelve new-name function bodies from the definitions
    --    currently deployed, so no runtime path keeps reading the
    --    compatibility views, the old helper names, or the old setting names.
    renamed_functions := array(
      select prefix || replace(base_name, 'rein_mvp_', 'rein_')
        from unnest(helper_functions) as t(base_name)
    );
    renamed_functions := renamed_functions || array[
      prefix || 'rein_finalize_poll',
      prefix || 'rein_approve_revision'
    ];

    select count(*)
      into function_count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (renamed_functions);
    if function_count <> 12 then
      raise exception 'expected 12 governance functions under the new names, found %',
        function_count;
    end if;

    for function_row in
      select p.oid
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any (renamed_functions)
       order by p.proname
    loop
      function_definition := pg_get_functiondef(function_row.oid);
      function_definition := replace(function_definition, 'rein_mvp_', 'rein_');
      function_definition := replace(function_definition, 'rein_mvp.', 'rein.');
      if position('rein_mvp' in function_definition) > 0 then
        raise exception 'function % still carries an mvp name after the rewrite',
          function_row.oid::regprocedure;
      end if;

      execute function_definition;
    end loop;

    -- 6. Move the remaining "mvp" names carried by the catalog objects the
    --    table rename in step 1 could not touch: the triggers, constraints,
    --    and indexes attached to the five governance tables. A table rename
    --    carries its objects to the new table but leaves each object's own
    --    name alone, so a trigger, constraint, or index keeps its old name
    --    until it is renamed here. Nothing is rebuilt and no rows are read:
    --    each pass is scoped by catalog lookup to these five tables only, so
    --    a stray "rein_mvp_" name on an unrelated table is left for its own
    --    migration. Order matters: constraints are renamed before indexes
    --    because a primary key or unique constraint owns its backing index,
    --    and renaming the constraint renames that index with it. Renaming
    --    the backing index afterwards would detach the constraint's name
    --    from it, so the index pass skips every constraint-owned index.
    -- unnest() flattens a text[][] to its scalar elements, so the second
    -- column is read by subscripting each row instead.
    physical_tables := array(
      select prefix || renamed_tables[i][2]
        from generate_subscripts(renamed_tables, 1) as i
    );

    -- 6a. Triggers. tgisinternal filters out the constraint-enforcement
    --     triggers Postgres creates for foreign keys, which carry a system
    --     name and cannot be renamed.
    for object_row in
      select tg.tgname, tg.tgrelid
        from pg_trigger tg
       where not tg.tgisinternal
         and tg.tgname like '%rein_mvp_%'
         and tg.tgrelid = any (
           select to_regclass(format('public.%I', table_name))
             from unnest(physical_tables) as table_name
         )
       order by tg.tgname
    loop
      old_object_name := object_row.tgname;
      new_object_name := replace(old_object_name, 'rein_mvp_', 'rein_');

      if exists (
        select 1
          from pg_trigger tg
         where tg.tgname = new_object_name
           and tg.tgrelid = object_row.tgrelid
      ) then
        raise exception 'refusing to rename trigger: % already exists', new_object_name;
      end if;

      execute format('alter trigger %I on %s rename to %I',
        old_object_name, object_row.tgrelid::regclass::text, new_object_name);
    end loop;

    -- 6b. Constraints, covering the check, foreign key, primary key, and
    --     unique names. Renaming a primary key or unique constraint also
    --     renames the index that backs it, which is why this runs first.
    for object_row in
      select con.conname, con.conrelid
        from pg_constraint con
       where con.conname like '%rein_mvp_%'
         and con.conrelid = any (
           select to_regclass(format('public.%I', table_name))
             from unnest(physical_tables) as table_name
         )
       order by con.conname
    loop
      old_object_name := object_row.conname;
      new_object_name := replace(old_object_name, 'rein_mvp_', 'rein_');

      if exists (
        select 1
          from pg_constraint con
         where con.conname = new_object_name
           and con.conrelid = object_row.conrelid
      ) then
        raise exception 'refusing to rename constraint: % already exists', new_object_name;
      end if;

      execute format('alter table %s rename constraint %I to %I',
        object_row.conrelid::regclass::text, old_object_name, new_object_name);
    end loop;

    -- 6c. Indexes that no constraint owns, such as the plain lookup indexes
    --     the earlier migration created with create index. Indices owned by a
    --     primary key or unique constraint were already renamed in step 6b,
    --     and are excluded here so the constraint keeps its backing index.
    for object_row in
      select cls.relname as index_name
        from pg_index ix
        join pg_class cls on cls.oid = ix.indexrelid
       where cls.relkind = 'i'
         and cls.relname like '%rein_mvp_%'
         and not exists (
           select 1 from pg_constraint con where con.conindid = ix.indexrelid
         )
         and ix.indrelid = any (
           select to_regclass(format('public.%I', table_name))
             from unnest(physical_tables) as table_name
         )
       order by cls.relname
    loop
      old_object_name := object_row.index_name;
      new_object_name := replace(old_object_name, 'rein_mvp_', 'rein_');

      if to_regclass(format('public.%I', new_object_name)) is not null then
        raise exception 'refusing to rename index: % already exists', new_object_name;
      end if;

      execute format('alter index public.%I rename to %I',
        old_object_name, new_object_name);
    end loop;

    -- 7. Assert the rename landed. After step 6 no trigger, constraint, or
    --    index on these five tables may still carry "rein_mvp_" in its name.
    --    The compatibility objects that intentionally keep the old name are
    --    views and functions, so they are outside this check: the views made
    --    in step 2 are pg_class relkind 'v' and the only old-name function
    --    names left are the two RPC wrappers created in step 3.
    select count(*)
      into leftover_count
      from pg_trigger tg
     where not tg.tgisinternal
       and tg.tgname like '%rein_mvp_%'
       and tg.tgrelid = any (
         select to_regclass(format('public.%I', table_name))
           from unnest(physical_tables) as table_name
       );
    if leftover_count <> 0 then
      raise exception 'expected no mvp-named triggers on the governance tables, found %',
        leftover_count;
    end if;

    select count(*)
      into leftover_count
      from pg_constraint con
     where con.conname like '%rein_mvp_%'
       and con.conrelid = any (
         select to_regclass(format('public.%I', table_name))
           from unnest(physical_tables) as table_name
       );
    if leftover_count <> 0 then
      raise exception 'expected no mvp-named constraints on the governance tables, found %',
        leftover_count;
    end if;

    select count(*)
      into leftover_count
      from pg_class cls
      join pg_index ix on ix.indexrelid = cls.oid
     where cls.relkind = 'i'
       and cls.relname like '%rein_mvp_%'
       and ix.indrelid = any (
         select to_regclass(format('public.%I', table_name))
           from unnest(physical_tables) as table_name
       );
    if leftover_count <> 0 then
      raise exception 'expected no mvp-named indexes on the governance tables, found %',
        leftover_count;
    end if;

  end loop;
end;
$rein_governance_names$;

notify pgrst, 'reload schema';

commit;
