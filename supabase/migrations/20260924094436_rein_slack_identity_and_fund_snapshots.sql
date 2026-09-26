-- Rein Agent MVP foundation: plugin-owned Slack identity links and
-- human-entered available-funds snapshots.
--
-- Scope is schema only. No proposals, ballots, payments, or identity/weight
-- escalation are added here, and the Agent receives no write access. Both
-- environments receive the identical structure in this one transaction, with
-- foreign keys staying inside their own prefix.
--
-- Access model for every table below: RLS is enabled, anon and authenticated
-- hold no table privileges, and service_role is the only grantee. Server-side
-- code already reaches application data with the secret key
-- (lib/supabase/secret.ts), so no policy is created for anon or authenticated:
-- RLS with zero policies denies every non-privileged role, including any grant
-- a future default ACL might add. Widen this deliberately in the change that
-- needs it.

begin;

-- Slack identity links map one trusted Slack team/user pair to one existing
-- community contact. A row records an administrator's verification decision,
-- so verified_at and verified_by are mandatory in both the verified and
-- revoked states, and a revoked link keeps the verification it replaces.
create table if not exists public.dev_rein_slack_links (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null check (length(btrim(slack_team_id)) > 0),
  slack_user_id text not null check (length(btrim(slack_user_id)) > 0),
  contact_id uuid not null references public.dev_community_contacts(id) on delete cascade,
  status text not null check (status in ('verified','revoked')),
  verified_at timestamptz,
  verified_by text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dev_rein_slack_links_slack_identity_key unique (slack_team_id, slack_user_id),
  constraint dev_rein_slack_links_status_consistent check (
    (status = 'verified' and verified_at is not null and verified_by is not null)
    or (status = 'revoked' and verified_at is not null and verified_by is not null and revoked_at is not null)
  )
);
create index if not exists dev_rein_slack_links_contact_idx on public.dev_rein_slack_links(contact_id);

create table if not exists public.prod_rein_slack_links (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null check (length(btrim(slack_team_id)) > 0),
  slack_user_id text not null check (length(btrim(slack_user_id)) > 0),
  contact_id uuid not null references public.prod_community_contacts(id) on delete cascade,
  status text not null check (status in ('verified','revoked')),
  verified_at timestamptz,
  verified_by text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prod_rein_slack_links_slack_identity_key unique (slack_team_id, slack_user_id),
  constraint prod_rein_slack_links_status_consistent check (
    (status = 'verified' and verified_at is not null and verified_by is not null)
    or (status = 'revoked' and verified_at is not null and verified_by is not null and revoked_at is not null)
  )
);
create index if not exists prod_rein_slack_links_contact_idx on public.prod_rein_slack_links(contact_id);

-- Available-funds snapshots are human-entered. available_minor is the amount in
-- the currency's minor unit, source_note is optional provenance, and the newest
-- recorded_at row per currency is the figure the Agent may read. Two snapshots
-- for one currency may never share a recorded_at instant: ordering by
-- recorded_at alone would be ambiguous, and the reader resolves the latest row
-- per currency exactly that way. recorded_at still defaults to now(), so the
-- ordinary insert path is unchanged.
create table if not exists public.dev_rein_fund_snapshots (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  available_minor integer not null check (available_minor >= 0),
  recorded_at timestamptz not null default now(),
  recorded_by text not null,
  source_note text,
  created_at timestamptz not null default now(),
  constraint dev_rein_fund_snapshots_currency_instant_key unique (currency, recorded_at)
);
create index if not exists dev_rein_fund_snapshots_recorded_idx on public.dev_rein_fund_snapshots(currency, recorded_at desc);

create table if not exists public.prod_rein_fund_snapshots (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  available_minor integer not null check (available_minor >= 0),
  recorded_at timestamptz not null default now(),
  recorded_by text not null,
  source_note text,
  created_at timestamptz not null default now(),
  constraint prod_rein_fund_snapshots_currency_instant_key unique (currency, recorded_at)
);
create index if not exists prod_rein_fund_snapshots_recorded_idx on public.prod_rein_fund_snapshots(currency, recorded_at desc);

-- Append-only enforcement. A wrong figure is corrected with a new snapshot
-- rather than an edit, so UPDATE and DELETE are rejected for every role,
-- service_role included. Dropping the trigger requires its own migration.
create or replace function public.dev_rein_fund_snapshots_reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'available-funds snapshots are append-only; insert a correcting snapshot instead'
    using errcode = 'restrict_violation';
end;
$$;
revoke all on function public.dev_rein_fund_snapshots_reject_mutation() from public, anon, authenticated;

create or replace function public.prod_rein_fund_snapshots_reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'available-funds snapshots are append-only; insert a correcting snapshot instead'
    using errcode = 'restrict_violation';
end;
$$;
revoke all on function public.prod_rein_fund_snapshots_reject_mutation() from public, anon, authenticated;

drop trigger if exists dev_rein_fund_snapshots_append_only on public.dev_rein_fund_snapshots;
create trigger dev_rein_fund_snapshots_append_only
  before update or delete on public.dev_rein_fund_snapshots
  for each row execute function public.dev_rein_fund_snapshots_reject_mutation();

drop trigger if exists prod_rein_fund_snapshots_append_only on public.prod_rein_fund_snapshots;
create trigger prod_rein_fund_snapshots_append_only
  before update or delete on public.prod_rein_fund_snapshots
  for each row execute function public.prod_rein_fund_snapshots_reject_mutation();

alter table public.dev_rein_slack_links enable row level security;
alter table public.prod_rein_slack_links enable row level security;
alter table public.dev_rein_fund_snapshots enable row level security;
alter table public.prod_rein_fund_snapshots enable row level security;

revoke all on table public.dev_rein_slack_links from public, anon, authenticated;
revoke all on table public.prod_rein_slack_links from public, anon, authenticated;
revoke all on table public.dev_rein_fund_snapshots from public, anon, authenticated;
revoke all on table public.prod_rein_fund_snapshots from public, anon, authenticated;

grant all privileges on table public.dev_rein_slack_links to service_role;
grant all privileges on table public.prod_rein_slack_links to service_role;
grant all privileges on table public.dev_rein_fund_snapshots to service_role;
grant all privileges on table public.prod_rein_fund_snapshots to service_role;

notify pgrst, 'reload schema';

commit;
