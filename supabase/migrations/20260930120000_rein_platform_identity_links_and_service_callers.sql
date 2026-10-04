-- Rein platform identity links, website-verified email challenges, registered
-- service callers, and short-lived ingress assertions.
--
-- This migration generalizes the earlier `<env>_rein_slack_links` table into a
-- platform-neutral binding table and adds the records the website needs to run
-- a binding flow that a person completes on the website, after proving control
-- of a registered address. It carries no transport credentials, no provider
-- tokens and no email content.
--
-- Rules encoded here:
--   * exactly one row per (platform, workspace, platform user) tuple, whatever
--     its status. A revoked row is a tombstone: it keeps the tuple occupied so
--     the same account can never silently re-bind itself after a revocation.
--     Clearing a tombstone is an administrator action, never an automatic one.
--   * one contact may hold several platform identities, so no uniqueness is
--     placed on contact_id. Uniqueness is only the platform tuple.
--   * a live binding is a grant only while status = 'verified' and
--     validity_expires_at is in the future. Matching is re-read on every
--     request; nothing about a caller's claim is persisted as authority.
--   * binding is only ever completed through a linked email challenge whose
--     raw one-time code was confirmed on the website. The challenge stores the
--     address digest and the code digest, never a raw value.
--   * service callers are machine principals. They carry explicit scopes plus
--     optional platform/workspace and native channel allowlists. A machine
--     credential never confers a human role: Contributor and director status
--     are always derived from community records at request time.
--   * ingress assertions are short-lived receipts minted from a verified
--     platform event. They bind the caller, platform tuple, channel and event
--     id, and they expire on their own.
--
-- Both environments receive the identical structure in this one transaction,
-- with foreign keys staying inside their own prefix.
--
-- Access model for every table below: RLS is enabled, anon and authenticated
-- hold no table privileges, and service_role is the only grantee. Server-side
-- code already reaches application data with the secret key
-- (lib/supabase/secret.ts), so no policy is created for anon or authenticated:
-- RLS with zero policies denies every non-privileged role, including any grant
-- a future default ACL might add. Widen this deliberately in the change that
-- needs it.
--
-- Provisional assumption, pending owner confirmation: a completed binding is
-- valid for ten years and a website email code expires ten minutes after it is
-- issued. Both are stored on the row, so a later policy change is a value
-- change rather than a schema change.

begin;

do $rein_platform_identity$
declare
  prefix text;
  table_name text;
  environment_tables text[] := array[
    'rein_platform_links',
    'rein_link_sessions',
    'rein_link_email_challenges',
    'rein_service_callers',
    'rein_ingress_assertions'
  ];
begin
  foreach prefix in array array['dev_', 'prod_'] loop
    -- Platform bindings. The tuple is unique across statuses so a revocation
    -- leaves a tombstone rather than a free slot.
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        platform text not null check (platform in ('slack', 'discord')),
        platform_workspace_id text not null check (length(btrim(platform_workspace_id)) > 0),
        platform_user_id text not null check (length(btrim(platform_user_id)) > 0),
        platform_channel_id text,
        contact_id uuid not null references public.%I(id) on delete cascade,
        status text not null check (status in ('verified', 'revoked')),
        validity_expires_at timestamptz not null,
        verified_at timestamptz not null,
        verified_by text not null,
        revoked_at timestamptz,
        revoked_by text,
        revoked_reason text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %I unique (platform, platform_workspace_id, platform_user_id),
        constraint %I check (
          (status = 'verified' and revoked_at is null and revoked_by is null)
          or (status = 'revoked' and revoked_at is not null and revoked_by is not null)
        ),
        constraint %I check (validity_expires_at > verified_at)
      )
    $ddl$,
      prefix || 'rein_platform_links',
      prefix || 'community_contacts',
      prefix || 'rein_platform_links_identity_key',
      prefix || 'rein_platform_links_status_consistent',
      prefix || 'rein_platform_links_validity_check');

    execute format(
      'create index if not exists %I on public.%I(contact_id)',
      prefix || 'rein_platform_links_contact_idx', prefix || 'rein_platform_links');
    execute format(
      'create index if not exists %I on public.%I(platform, status, validity_expires_at)',
      prefix || 'rein_platform_links_lookup_idx', prefix || 'rein_platform_links');

    -- One binding session per platform tuple in flight. The session token hash
    -- is what the website URL carries; the raw value is never stored.
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        platform text not null check (platform in ('slack', 'discord')),
        platform_workspace_id text not null check (length(btrim(platform_workspace_id)) > 0),
        platform_user_id text not null check (length(btrim(platform_user_id)) > 0),
        platform_channel_id text not null check (length(btrim(platform_channel_id)) > 0),
        state text not null default 'awaiting_email' check (
          state in ('awaiting_email', 'email_verified', 'completed', 'expired', 'cancelled')),
        session_token_hash text not null,
        contact_id uuid references public.%I(id) on delete set null,
        created_by_caller_id text,
        expires_at timestamptz not null,
        email_verified_at timestamptz,
        binding_code_hash text,
        binding_code_expires_at timestamptz,
        binding_code_consumed_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %I unique (session_token_hash),
        constraint %I check (state <> 'completed' or (contact_id is not null and completed_at is not null)),
        constraint %I check (state <> 'email_verified' or email_verified_at is not null),
        constraint %I check (binding_code_hash is null or binding_code_expires_at is not null)
      )
    $ddl$,
      prefix || 'rein_link_sessions',
      prefix || 'community_contacts',
      prefix || 'rein_link_sessions_token_key',
      prefix || 'rein_link_sessions_completed_check',
      prefix || 'rein_link_sessions_email_check',
      prefix || 'rein_link_sessions_binding_code_check');

    execute format(
      'create index if not exists %I on public.%I(platform, platform_workspace_id, platform_user_id)',
      prefix || 'rein_link_sessions_tuple_idx', prefix || 'rein_link_sessions');

    -- The website-verified email challenge. The address digest and the code
    -- digest are stored; the raw code exists only in the browser that received
    -- it after the address was confirmed.
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        session_id uuid not null references public.%I(id) on delete cascade,
        email_hash text not null,
        email_masked text not null,
        receipt_token_hash text not null,
        ip_hash text,
        code_hash text,
        code_expires_at timestamptz,
        code_consumed_at timestamptz,
        attempt_count integer not null default 0,
        resolved_contact_id uuid references public.%I(id) on delete set null,
        outcome text not null default 'pending' check (
          outcome in ('pending', 'verified', 'denied_ambiguous', 'expired')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %I check (code_hash is null or code_expires_at is not null),
        constraint %I check (length(btrim(receipt_token_hash)) > 0)
      )
    $ddl$,
      prefix || 'rein_link_email_challenges',
      prefix || 'rein_link_sessions',
      prefix || 'community_contacts',
      prefix || 'rein_link_email_challenges_code_check',
      prefix || 'rein_link_email_challenges_receipt_check');

    execute format(
      'create unique index if not exists %I on public.%I(receipt_token_hash)',
      prefix || 'rein_link_email_challenges_receipt_key', prefix || 'rein_link_email_challenges');

    execute format(
      'create unique index if not exists %I on public.%I(code_hash) where code_hash is not null',
      prefix || 'rein_link_email_challenges_code_key', prefix || 'rein_link_email_challenges');
    execute format(
      'create index if not exists %I on public.%I(session_id, created_at desc)',
      prefix || 'rein_link_email_challenges_session_idx', prefix || 'rein_link_email_challenges');

    -- Registered machine principals. The credential is stored as a digest; the
    -- raw secret is returned exactly once at registration and never readable
    -- again.
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        caller_id text not null check (length(btrim(caller_id)) > 0),
        label text not null check (length(btrim(label)) > 0),
        credential_hash text not null,
        scopes text[] not null default '{}'::text[],
        platform_allowlist jsonb not null default '[]'::jsonb,
        channel_allowlist jsonb not null default '[]'::jsonb,
        status text not null default 'enabled' check (status in ('enabled', 'revoked')),
        created_by text not null,
        revoked_at timestamptz,
        revoked_by text,
        last_used_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %I unique (caller_id),
        constraint %I unique (credential_hash),
        constraint %I check ((status = 'revoked') = (revoked_at is not null)),
        constraint %I check (jsonb_typeof(platform_allowlist) = 'array'),
        constraint %I check (jsonb_typeof(channel_allowlist) = 'array'),
        constraint %I check (array_position(scopes, null) is null)
      )
    $ddl$,
      prefix || 'rein_service_callers',
      prefix || 'rein_service_callers_caller_key',
      prefix || 'rein_service_callers_credential_key',
      prefix || 'rein_service_callers_revoked_check',
      prefix || 'rein_service_callers_platform_allowlist_check',
      prefix || 'rein_service_callers_channel_allowlist_check',
      prefix || 'rein_service_callers_scopes_check');

    -- Short-lived assertion minted from one verified platform event. The raw
    -- assertion value goes back to the trusted relay and is never a model
    -- argument.
    execute format($ddl$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        assertion_token_hash text not null,
        caller_id text not null,
        platform text not null check (platform in ('slack', 'discord')),
        platform_workspace_id text not null check (length(btrim(platform_workspace_id)) > 0),
        platform_user_id text not null check (length(btrim(platform_user_id)) > 0),
        platform_channel_id text not null check (length(btrim(platform_channel_id)) > 0),
        event_id text not null,
        source text not null check (source in ('http_signature', 'relay')),
        payload_digest text not null,
        expires_at timestamptz not null,
        consumed_at timestamptz,
        created_at timestamptz not null default now(),
        constraint %I unique (assertion_token_hash)
      )
    $ddl$,
      prefix || 'rein_ingress_assertions',
      prefix || 'rein_ingress_assertions_token_key');

    execute format(
      'create index if not exists %I on public.%I(expires_at)',
      prefix || 'rein_ingress_assertions_expiry_idx', prefix || 'rein_ingress_assertions');
    -- One assertion per verified event, so a repeater cannot mint an unbounded
    -- number of proofs for the same delivery. The assertion itself stays usable
    -- until it expires; only its creation is deduplicated.
    execute format(
      'create unique index if not exists %I on public.%I(caller_id, platform, platform_workspace_id, event_id)',
      prefix || 'rein_ingress_assertions_event_key', prefix || 'rein_ingress_assertions');

    foreach table_name in array environment_tables loop
      table_name := prefix || table_name;
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
      execute format('grant all privileges on table public.%I to service_role', table_name);
    end loop;

    -- Carry the earlier Slack links forward as platform links. A verified row
    -- becomes a live binding with the default validity; a revoked row is copied
    -- as a tombstone so the same tuple can never silently re-bind. Rows that
    -- already exist for a tuple are left alone. No address is consulted, so
    -- nothing here creates a binding from an email match.
    execute format($ddl$
      insert into public.%I (
        platform, platform_workspace_id, platform_user_id, platform_channel_id,
        contact_id, status, validity_expires_at, verified_at, verified_by,
        revoked_at, revoked_by, created_at, updated_at)
      select
        'slack', l.slack_team_id, l.slack_user_id, null,
        l.contact_id, l.status,
        coalesce(l.verified_at, l.created_at, now()) + interval '10 years',
        coalesce(l.verified_at, l.created_at, now()),
        coalesce(l.verified_by, 'legacy-slack-link'),
        l.revoked_at,
        case when l.revoked_at is null then null else coalesce(l.verified_by, 'legacy-slack-link') end,
        l.created_at, l.updated_at
      from public.%I l
      on conflict (platform, platform_workspace_id, platform_user_id) do nothing
    $ddl$,
      prefix || 'rein_platform_links', prefix || 'rein_slack_links');
  end loop;
end;
$rein_platform_identity$;

notify pgrst, 'reload schema';

commit;
