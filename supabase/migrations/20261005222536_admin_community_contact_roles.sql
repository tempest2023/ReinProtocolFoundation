-- Give administrators one audited, transactional operation for assigning
-- Contributor and director eligibility to an existing community contact.
-- Director authorization is intentionally independent from profile publication:
-- withdrawing a public profile is not the same operation as removing governance
-- authority, and an archived profile must not silently retain that authority.

begin;

do $admin_contact_roles$
declare
  prefix text;
  table_name text;
  current_director_template text := $template$
select exists (
  select 1
    from public.{p}people as person
   where person.person_type = 'director'
     and person.authorization_status = 'active'
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
  manage_roles_template text := $template$
declare
  v_contributor_id uuid;
  v_contributor_before text := 'none';
  v_director_id uuid;
  v_director_before text := 'none';
begin
  if p_contributor_status not in ('active', 'inactive') then
    raise exception 'invalid_contributor_status';
  end if;
  if p_director_status not in ('active', 'inactive') then
    raise exception 'invalid_director_status';
  end if;

  perform 1
    from public.{p}community_contacts
   where id = p_contact_id
     and deleted_at is null
   for update;
  if not found then
    raise exception 'contact_not_found';
  end if;

  select contributor.id, contributor.status into v_contributor_id, v_contributor_before
    from public.{p}contributors as contributor
   where contributor.contact_id = p_contact_id
   for update;

  if p_contributor_status = 'active' then
    if v_contributor_id is null then
      insert into public.{p}contributors(contact_id, status, notes)
      values (p_contact_id, 'active', 'Assigned directly by an administrator without an application.')
      returning {p}contributors.id into v_contributor_id;
    else
      update public.{p}contributors
         set status = 'active', updated_at = now()
       where {p}contributors.id = v_contributor_id;
    end if;
  elsif v_contributor_id is not null then
    update public.{p}contributors
       set status = 'inactive', updated_at = now()
     where {p}contributors.id = v_contributor_id;
  end if;

  select person.id, person.authorization_status into v_director_id, v_director_before
    from public.{p}people as person
   where person.person_type = 'director'
     and (
       person.contact_id = p_contact_id
       or (v_contributor_id is not null and person.contributor_id = v_contributor_id)
     )
   for update;

  if p_director_status = 'active' then
    if v_director_id is null then
      perform 1
        from public.{p}people as person
       where person.contact_id = p_contact_id
          or (v_contributor_id is not null and person.contributor_id = v_contributor_id)
       for update;
      if found then
        raise exception 'contact_has_non_director_profile';
      end if;
      if nullif(btrim(p_director_display_name), '') is null
         or nullif(btrim(p_director_slug), '') is null
         or nullif(btrim(p_director_role), '') is null then
        raise exception 'director_profile_required';
      end if;
      if p_director_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
        raise exception 'director_slug_invalid';
      end if;

      insert into public.{p}people(
        contact_id, slug, display_name, person_type, role,
        authorization_status, publication_status)
      values (
        p_contact_id, btrim(p_director_slug), btrim(p_director_display_name),
        'director', btrim(p_director_role), 'active', 'draft')
      returning {p}people.id into v_director_id;
    else
      update public.{p}people
         set authorization_status = 'active',
             display_name = coalesce(nullif(btrim(p_director_display_name), ''), display_name),
             slug = coalesce(nullif(btrim(p_director_slug), ''), slug),
             role = coalesce(nullif(btrim(p_director_role), ''), role),
             updated_at = now()
       where {p}people.id = v_director_id;
    end if;
  elsif v_director_id is not null then
    update public.{p}people
       set authorization_status = 'inactive', updated_at = now()
     where {p}people.id = v_director_id;
  end if;

  insert into public.{p}admin_audit_log(
    actor_type, actor_id, action, entity_type, entity_id, details)
  values (
    'admin', p_actor_id, 'contact.roles_changed', 'community_contact', p_contact_id,
    jsonb_build_object(
      'contributor', jsonb_build_object(
        'before', v_contributor_before,
        'after', p_contributor_status,
        'record_id', v_contributor_id),
      'director', jsonb_build_object(
        'before', v_director_before,
        'after', p_director_status,
        'record_id', v_director_id),
      'email_verification_bypassed', true));

  return query
    select p_contact_id,
      v_contributor_id,
      v_director_id,
      p_contributor_status = 'active',
      p_director_status = 'active';
end;
$template$;
  function_name text;
  function_definition text;
begin
  foreach prefix in array array['dev_', 'prod_'] loop
    table_name := prefix || 'people';
    execute format(
      'alter table public.%I add column if not exists authorization_status text not null default ''active''',
      table_name);

    if not exists (
      select 1
        from pg_constraint
       where conname = prefix || 'people_authorization_status_check'
    ) then
      execute format(
        'alter table public.%I add constraint %I check (authorization_status in (''active'', ''inactive''))',
        table_name,
        prefix || 'people_authorization_status_check');
    end if;

    execute format(
      'create index if not exists %I on public.%I(person_type, authorization_status)',
      prefix || 'people_authorization_idx',
      table_name);

    execute format(
      'create or replace function public.%I(p_contact_id uuid) returns boolean language sql stable set search_path = public, pg_temp as %L',
      prefix || 'rein_mvp_is_current_director',
      replace(current_director_template, '{p}', prefix));
    execute format(
      'revoke all on function public.%I(uuid) from public, anon, authenticated',
      prefix || 'rein_mvp_is_current_director');
    execute format(
      'grant execute on function public.%I(uuid) to service_role',
      prefix || 'rein_mvp_is_current_director');

    foreach function_name in array array[
      prefix || 'rein_resolve_platform_contact',
      prefix || 'rein_guarded_write'
    ] loop
      select pg_get_functiondef(procedure.oid)
        into function_definition
        from pg_proc as procedure
        join pg_namespace as namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname = function_name;
      if function_definition is null then
        raise exception 'required function % is missing', function_name;
      end if;
      if position('where p.person_type = ''director''' in function_definition) = 0 then
        raise exception 'director predicate not found in function %', function_name;
      end if;
      function_definition := replace(
        function_definition,
        'where p.person_type = ''director''',
        'where p.person_type = ''director'' and p.authorization_status = ''active''');
      execute function_definition;
    end loop;

    execute format(
      'create or replace function public.%I(p_contact_id uuid, p_contributor_status text, p_director_status text, p_director_display_name text, p_director_slug text, p_director_role text, p_actor_id text) returns table(contact_id uuid, contributor_id uuid, director_id uuid, is_active_contributor boolean, is_active_director boolean) language plpgsql security definer set search_path = public, pg_temp as %L',
      prefix || 'admin_set_contact_roles',
      replace(manage_roles_template, '{p}', prefix));
    execute format(
      'revoke all on function public.%I(uuid,text,text,text,text,text,text) from public, anon, authenticated',
      prefix || 'admin_set_contact_roles');
    execute format(
      'grant execute on function public.%I(uuid,text,text,text,text,text,text) to service_role',
      prefix || 'admin_set_contact_roles');
  end loop;
end;
$admin_contact_roles$;

commit;
