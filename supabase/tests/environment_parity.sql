begin;
select plan(7);

select is(
  (select count(*) from information_schema.tables where table_schema='public' and table_name like 'dev\_%' escape '\'),
  25::bigint,
  'development has every application table'
);

select is(
  (select count(*) from information_schema.tables where table_schema='public' and table_name like 'prod\_%' escape '\'),
  25::bigint,
  'production has every application table'
);

with dev_columns as (
  select replace(table_name,'dev_','') table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name,generation_expression
  from information_schema.columns
  where table_schema='public' and table_name like 'dev\_%' escape '\'
), prod_columns as (
  select replace(table_name,'prod_','') table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_name,generation_expression
  from information_schema.columns
  where table_schema='public' and table_name like 'prod\_%' escape '\'
)
select is(
  (select jsonb_agg(to_jsonb(dev_columns) order by table_name,ordinal_position) from dev_columns),
  (select jsonb_agg(to_jsonb(prod_columns) order by table_name,ordinal_position) from prod_columns),
  'development and production columns stay identical'
);

with environment_functions as (
  select
    regexp_replace(p.proname,'^(dev_|prod_)','') function_name,
    case when p.proname like 'dev\_%' escape '\' then 'dev' else 'prod' end environment,
    pg_get_function_identity_arguments(p.oid) arguments
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'dev\_%' escape '\' or p.proname like 'prod\_%' escape '\')
), dev_functions as (
  select function_name,arguments from environment_functions where environment='dev'
), prod_functions as (
  select function_name,arguments from environment_functions where environment='prod'
)
select is(
  (select jsonb_agg(to_jsonb(dev_functions) order by function_name,arguments) from dev_functions),
  (select jsonb_agg(to_jsonb(prod_functions) order by function_name,arguments) from prod_functions),
  'development and production RPC signatures stay identical'
);

select ok(
  not exists(
    select 1
    from pg_constraint c
    join pg_class source_table on source_table.oid=c.conrelid
    join pg_class target_table on target_table.oid=c.confrelid
    where c.contype='f'
      and ((source_table.relname like 'dev\_%' escape '\' and target_table.relname like 'prod\_%' escape '\')
        or (source_table.relname like 'prod\_%' escape '\' and target_table.relname like 'dev\_%' escape '\'))
  ),
  'there are no cross-environment foreign keys'
);

select lives_ok(
  $$select * from public.prod_register_community_participant('environment-test@example.org',null,'Education',null,'united_states','United States','CA','Oakland',true,true)$$,
  'production participant registration RPC is executable'
);

select is(
  (select count(*) from public.prod_member_count_events where source='community_registration'),
  1::bigint,
  'production registration writes only to the production count ledger'
);

select * from finish();
rollback;
