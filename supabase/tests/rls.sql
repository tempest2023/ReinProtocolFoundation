begin;
select plan(39);

select ok((select relrowsecurity from pg_class where oid='public.dev_community_participants'::regclass),'participant RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.dev_contributor_applications'::regclass),'application RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.dev_agent_runs'::regclass),'Agent run RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.dev_form_rate_limits'::regclass),'rate-limit RLS is enabled');
select policies_are('public','dev_resources',array['dev_admin_resources','dev_public_resources_read'],'development resources expose only public read and admin access policies');
select policies_are('public','dev_people',array['dev_admin_people','dev_public_people_read'],'development People expose only consented public read and admin access policies');

select ok((select relrowsecurity from pg_class where oid='public.prod_community_participants'::regclass),'production participant RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.prod_contributor_applications'::regclass),'production application RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.prod_agent_runs'::regclass),'production Agent run RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.prod_form_rate_limits'::regclass),'production rate-limit RLS is enabled');
select policies_are('public','prod_resources',array['prod_admin_resources','prod_public_resources_read'],'production resources expose only public read and admin access policies');
select policies_are('public','prod_people',array['prod_admin_people','prod_public_people_read'],'production People expose only consented public read and admin access policies');

select ok((select relrowsecurity from pg_class where oid='public.dev_rein_slack_links'::regclass),'development Slack links RLS is enabled');
select policies_are('public','dev_rein_slack_links',array[]::text[],'development Slack links expose no Data API policies');
select ok(not has_table_privilege('anon','public.dev_rein_slack_links','select') and not has_table_privilege('authenticated','public.dev_rein_slack_links','select') and has_table_privilege('service_role','public.dev_rein_slack_links','select'),'development Slack links are readable by service_role only');

select ok((select relrowsecurity from pg_class where oid='public.prod_rein_slack_links'::regclass),'production Slack links RLS is enabled');
select policies_are('public','prod_rein_slack_links',array[]::text[],'production Slack links expose no Data API policies');
select ok(not has_table_privilege('anon','public.prod_rein_slack_links','select') and not has_table_privilege('authenticated','public.prod_rein_slack_links','select') and has_table_privilege('service_role','public.prod_rein_slack_links','select'),'production Slack links are readable by service_role only');

select ok((select relrowsecurity from pg_class where oid='public.dev_rein_fund_snapshots'::regclass),'development funds snapshot RLS is enabled');
select policies_are('public','dev_rein_fund_snapshots',array[]::text[],'development funds snapshots expose no Data API policies');
select ok(not has_table_privilege('anon','public.dev_rein_fund_snapshots','select') and not has_table_privilege('authenticated','public.dev_rein_fund_snapshots','select') and has_table_privilege('service_role','public.dev_rein_fund_snapshots','select'),'development funds snapshots are readable by service_role only');

select ok((select relrowsecurity from pg_class where oid='public.prod_rein_fund_snapshots'::regclass),'production funds snapshot RLS is enabled');
select policies_are('public','prod_rein_fund_snapshots',array[]::text[],'production funds snapshots expose no Data API policies');
select ok(not has_table_privilege('anon','public.prod_rein_fund_snapshots','select') and not has_table_privilege('authenticated','public.prod_rein_fund_snapshots','select') and has_table_privilege('service_role','public.prod_rein_fund_snapshots','select'),'production funds snapshots are readable by service_role only');

select col_is_unique('public','dev_rein_fund_snapshots',array['currency','recorded_at'],'a currency cannot have two development snapshots at the same recorded_at');
select col_is_unique('public','prod_rein_fund_snapshots',array['currency','recorded_at'],'a currency cannot have two production snapshots at the same recorded_at');
select throws_ok(
  $$insert into public.dev_rein_fund_snapshots(currency,available_minor,recorded_at,recorded_by)
    values ('USD',100,'2026-09-24T00:00:00Z','admin@example.org'),
           ('USD',200,'2026-09-24T00:00:00Z','admin@example.org')$$,
  '23505',null,'two development snapshots at the same recorded_at are rejected'
);

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where relnamespace='public'::regnamespace
      and relname in ('dev_rein_mvp_vote_types','dev_rein_mvp_proposals','dev_rein_mvp_polls','dev_rein_mvp_ballots',
                      'dev_rein_mvp_proposal_revisions')),
  'development governance RLS is enabled'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where relnamespace='public'::regnamespace
      and relname in ('prod_rein_mvp_vote_types','prod_rein_mvp_proposals','prod_rein_mvp_polls','prod_rein_mvp_ballots',
                      'prod_rein_mvp_proposal_revisions')),
  'production governance RLS is enabled'
);
select policies_are(
  'public','dev_rein_mvp_proposals',array[]::text[],
  'development governance tables expose no Data API policies'
);
select policies_are(
  'public','prod_rein_mvp_proposals',array[]::text[],
  'production governance tables expose no Data API policies'
);
select ok(
  not exists(
    select 1 from (values ('anon'),('authenticated')) role_name(role_name),
      unnest(array['dev_rein_mvp_vote_types','dev_rein_mvp_proposals','dev_rein_mvp_polls','dev_rein_mvp_ballots',
                   'dev_rein_mvp_proposal_revisions']) t
    where has_table_privilege(role_name.role_name,'public.'||t,'select,insert,update,delete')
  )
  and (select bool_and(has_table_privilege('service_role','public.'||t,'select,insert,update,delete'))
       from unnest(array['dev_rein_mvp_vote_types','dev_rein_mvp_proposals','dev_rein_mvp_polls','dev_rein_mvp_ballots',
                         'dev_rein_mvp_proposal_revisions']) t),
  'development governance tables are readable by service_role only'
);
select ok(
  not exists(
    select 1 from (values ('anon'),('authenticated')) role_name(role_name),
      unnest(array['prod_rein_mvp_vote_types','prod_rein_mvp_proposals','prod_rein_mvp_polls','prod_rein_mvp_ballots',
                   'prod_rein_mvp_proposal_revisions']) t
    where has_table_privilege(role_name.role_name,'public.'||t,'select,insert,update,delete')
  )
  and (select bool_and(has_table_privilege('service_role','public.'||t,'select,insert,update,delete'))
       from unnest(array['prod_rein_mvp_vote_types','prod_rein_mvp_proposals','prod_rein_mvp_polls','prod_rein_mvp_ballots',
                         'prod_rein_mvp_proposal_revisions']) t),
  'production governance tables are readable by service_role only'
);

select policies_are(
  'public','dev_rein_mvp_proposal_revisions',array[]::text[],
  'development feedback table exposes no Data API policies'
);
select policies_are(
  'public','prod_rein_mvp_proposal_revisions',array[]::text[],
  'production feedback table exposes no Data API policies'
);
select ok(
  not exists(
    select 1
      from (values ('anon'),('authenticated')) role_name(role_name),
           unnest(array['dev_rein_mvp_poll_winner(uuid)',
                        'dev_rein_mvp_finalize_poll(uuid,uuid)',
                        'dev_rein_mvp_approve_revision(uuid,uuid)']) signature
     where has_function_privilege(role_name.role_name,'public.'||signature,'execute')
  )
  and (select bool_and(has_function_privilege('service_role','public.'||signature,'execute'))
       from unnest(array['dev_rein_mvp_poll_winner(uuid)',
                         'dev_rein_mvp_finalize_poll(uuid,uuid)',
                         'dev_rein_mvp_approve_revision(uuid,uuid)']) signature),
  'development finalization and approval RPCs are executable by service_role only'
);
select ok(
  not exists(
    select 1
      from (values ('anon'),('authenticated')) role_name(role_name),
           unnest(array['prod_rein_mvp_poll_winner(uuid)',
                        'prod_rein_mvp_finalize_poll(uuid,uuid)',
                        'prod_rein_mvp_approve_revision(uuid,uuid)']) signature
     where has_function_privilege(role_name.role_name,'public.'||signature,'execute')
  )
  and (select bool_and(has_function_privilege('service_role','public.'||signature,'execute'))
       from unnest(array['prod_rein_mvp_poll_winner(uuid)',
                         'prod_rein_mvp_finalize_poll(uuid,uuid)',
                         'prod_rein_mvp_approve_revision(uuid,uuid)']) signature),
  'production finalization and approval RPCs are executable by service_role only'
);
select ok(
  (select bool_and(has_column_privilege('service_role','public.dev_rein_mvp_proposals',column_name,'select'))
     from unnest(array['location','schedule','personnel','event_flow']) column_name),
  'development proposals persist the material fields as their own columns'
);
select ok(
  (select bool_and(has_column_privilege('service_role','public.prod_rein_mvp_proposals',column_name,'select'))
     from unnest(array['location','schedule','personnel','event_flow']) column_name),
  'production proposals persist the material fields as their own columns'
);

select * from finish();
rollback;
