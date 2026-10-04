#!/usr/bin/env node
/**
 * Local-only pgTAP runner for the Rein platform identity guard functions.
 *
 * It starts a throwaway postgres container (no published ports, no remote
 * database, no stored credentials), creates the Supabase-shaped prerequisites
 * the migrations assume, applies every supabase/migrations/*.sql in filename
 * order, then runs supabase/tests/identity_linking.sql through psql and prints
 * the raw TAP output with its plan and result counts.
 *
 * After the in-process pgTAP suite it runs a second phase over two real psql
 * connections, because a single transaction cannot exercise a race: the
 * concurrency file blocks one back end inside a completed-but-uncommitted
 * redemption while a second back end attempts the same redemption, and the
 * runner asserts exactly one redemption committed.
 *
 * Usage:
 *   node scripts/run-identity-db-tests.mjs [--keep]
 *
 * --keep skips teardown so the container can be inspected; its name is printed.
 *
 * Environment:
 *   IDENTITY_TEST_POSTGRES_IMAGE  postgres image to run (default postgres:17)
 *   IDENTITY_TEST_CONTAINER       container name override
 *
 * The stock postgres image does not ship pgTAP, so the runner installs
 * postgresql-<major>-pgtap inside the container when `create extension pgtap`
 * is not already satisfiable. Nothing else is installed, and the only network
 * access is the docker image pull plus that package install.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const testFile = join(repoRoot, 'supabase', 'tests', 'identity_linking.sql');
const guardedWriteFile = join(repoRoot, 'supabase', 'tests', 'guarded_write.sql');
const concurrencyFile = join(repoRoot, 'supabase', 'tests', 'identity_linking_concurrency.sql');
const image = process.env.IDENTITY_TEST_POSTGRES_IMAGE || 'postgres:17';
const keepContainer = process.argv.includes('--keep');
const database = 'rein_identity_tests';
const container =
  process.env.IDENTITY_TEST_CONTAINER ||
  `rein-identity-db-tests-${process.pid}-${Date.now().toString(36)}`;

const BOOTSTRAP_SQL = `
-- Supabase shape the migrations assume, on a stock postgres server.
create extension if not exists pgcrypto;

do $rein_bootstrap_roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$rein_bootstrap_roles$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  avif_autodetection boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;
`;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

/** Run psql inside the container, feeding `sql` on stdin. */
function psql(sql, { db = database, tap = false, stopOnError = true } = {}) {
  const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-X'];
  if (db) args.push('-d', db);
  args.push('-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`);
  if (tap) {
    args.push('-q', '-t', '-A');
  } else {
    args.push('-q');
  }
  args.push('-f', '-');

  return spawnSync('docker', args, {
    encoding: 'utf8',
    input: sql,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function psqlValue(sql, db = 'postgres') {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-d', db, '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  return (result.stdout || '').trim();
}

/**
 * Start a `psql` process on its own connection. The caller writes SQL to the
 * returned child's stdin, which is what makes it a second real back end rather
 * than another statement in the same transaction.
 */
function psqlStart() {
  return spawn(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-q', '-t', '-A', '-d', database],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

/** Start a back end and hand it one script. */
function psqlSession(sql) {
  const child = psqlStart();
  child.stdin.end(sql);
  return child;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ timedOut: true, status: null, stdout: '', stderr: '' }), timeoutMs);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => finish({ timedOut: false, status, stdout, stderr }));
    child.on('error', (error) => finish({ timedOut: false, status: null, stdout, stderr: `${stderr}${error.message}` }));
  });
}

/**
 * Wait until a second back end is blocked on a lock held by another session.
 *
 * A marker row written inside the first session's open transaction is invisible
 * to any other connection, so the signal has to come from the lock itself:
 * `pg_stat_activity` reports a session waiting with `wait_event_type = 'Lock'`,
 * which is exactly the state a real race is in. That makes the ordering
 * evidence-based: the second statement runs only while the first is genuinely
 * holding its transaction open.
 */
async function awaitBlockedBackend(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = psqlValue(
      "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and state = 'active' and pid <> pg_backend_pid()",
      database,
    );
    if (Number(waiting) > 0) return true;
    await sleep(50);
  }
  return false;
}

function bootstrapRolesAndSchemas() {
  const result = psql(BOOTSTRAP_SQL);
  if (result.status !== 0) {
    throw new Error(
      `bootstrap failed (exit ${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  log('bootstrap: roles anon/authenticated/service_role, schemas auth and storage, pgcrypto present');
}

function ensurePgtap() {
  const available = psqlValue("select count(*) from pg_available_extensions where name = 'pgtap'");
  if (Number(available) === 0) {
    const serverVersionNum = psqlValue('show server_version_num');
    const major = serverVersionNum ? Math.floor(Number(serverVersionNum) / 10000) : null;
    if (!major) {
      throw new Error(`cannot determine the postgres major version (got "${serverVersionNum}")`);
    }

    log(`pgTAP is not in ${image}; installing postgresql-${major}-pgtap inside the container`);
    const install = docker([
      'exec',
      container,
      'sh',
      '-lc',
      `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-${major}-pgtap`,
    ]);
    if (install.status !== 0) {
      throw new Error(
        'could not install pgTAP, so the pgTAP suite cannot run here\n' +
          `${install.stdout || ''}\n${install.stderr || ''}`,
      );
    }
  }

  const created = psql('create extension if not exists pgtap;');
  if (created.status !== 0) {
    throw new Error(
      `create extension pgtap failed (exit ${created.status})\n` +
        `${created.stdout || ''}\n${created.stderr || ''}`,
    );
  }
  log(`pgTAP ready: ${psqlValue("select extversion from pg_extension where extname = 'pgtap'", database)}`);
}

async function startContainer() {
  const existing = docker(['inspect', '--format', '{{.State.Status}}', container]);
  if (existing.status === 0) {
    throw new Error(`container ${container} already exists`);
  }

  log(`$ docker run -d --name ${container} -e POSTGRES_HOST_AUTH_METHOD=trust ${image}`);
  const started = docker([
    'run',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    image,
  ]);
  if (started.status !== 0) {
    throw new Error(`docker run failed (exit ${started.status})\n${started.stderr || ''}`);
  }

  // Two consecutive successful connections: the entrypoint runs a temporary
  // server during initialisation and restarts it, so a single success is not
  // enough evidence that the real cluster is up.
  let consecutive = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const probe = spawnSync(
      'docker',
      ['exec', container, 'psql', '-U', 'postgres', '-X', '-q', '-c', 'select 1'],
      { encoding: 'utf8' },
    );
    if (probe.status === 0) {
      consecutive += 1;
      if (consecutive >= 2) {
        log(`container ready: ${psqlValue('select version()')}`);
        return;
      }
    } else {
      consecutive = 0;
    }
    await sleep(1000);
  }
  throw new Error(`container ${container} did not accept connections within 90s`);
}

function teardown() {
  if (keepContainer) {
    log(`--keep: leaving ${container} running (docker exec -it ${container} psql -U postgres -d ${database})`);
    return;
  }
  log(`$ docker rm -f ${container}`);
  const removed = docker(['rm', '-f', container]);
  if (removed.status !== 0) {
    log(`teardown warning: could not remove ${container}\n${removed.stderr || ''}`);
  } else {
    log('container removed');
  }
}

function createDatabase() {
  const created = docker(['exec', container, 'createdb', '-U', 'postgres', database]);
  if (created.status !== 0) {
    throw new Error(`createdb ${database} failed\n${created.stderr || ''}`);
  }
}

function applyMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) throw new Error(`no migrations found in ${migrationsDir}`);

  for (const name of files) {
    const path = join(migrationsDir, name);
    process.stdout.write(`${name} ... `);
    const result = psql(readFileSync(path, 'utf8'));
    if (result.status !== 0) {
      log('FAILED');
      throw new Error(
        `migration ${name} failed (psql exit ${result.status})\n` +
          `--- stdout ---\n${(result.stdout || '').trim()}\n` +
          `--- stderr ---\n${(result.stderr || '').trim()}`,
      );
    }
    log('ok');
  }
  return files;
}

function runSuiteFile(file, label) {
  log('');
  log(
    `$ docker exec -i ${container} psql -U postgres -X -d ${database} -v ON_ERROR_STOP=1 -q -t -A -f - < ${label}`,
  );
  const result = psql(readFileSync(file, 'utf8'), { tap: true });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  log('');
  log(`--- raw pgTAP output (${label}) ---`);
  log(stdout.trimEnd());

  const lines = stdout.split('\n').map((line) => line.trim());
  const planLine = lines.find((line) => /^1\.\.\d+$/.test(line));
  const planned = planLine ? Number(planLine.slice(3)) : null;
  const passed = lines.filter((line) => /^ok\s+\d+/.test(line)).length;
  const failed = lines.filter((line) => /^not ok\s+\d+/.test(line)).length;
  const tapFailed = /^not ok/m.test(stdout);

  log('');
  log(`--- summary (${label}) ---`);
  log(`planned:   ${planned === null ? 'no plan line found' : planned}`);
  log(`passed:    ${passed}`);
  log(`failed:    ${failed}`);
  log(`psql exit: ${result.status}`);
  if (stderr.trim()) log(`--- stderr ---\n${stderr.trim()}`);

  const ok =
    result.status === 0 &&
    planned !== null &&
    planned === passed + failed &&
    !tapFailed;
  log(`result: ${ok ? 'PASSED' : 'FAILED'}`);
  return ok;
}

function runSuites() {
  const linkingOk = runSuiteFile(testFile, 'supabase/tests/identity_linking.sql');
  const guardedOk = runSuiteFile(guardedWriteFile, 'supabase/tests/guarded_write.sql');
  return linkingOk && guardedOk;
}

async function main() {
  if (!existsSync(migrationsDir)) throw new Error(`missing ${migrationsDir}`);
  if (!existsSync(testFile)) throw new Error(`missing ${testFile}`);
  if (!existsSync(guardedWriteFile)) throw new Error(`missing ${guardedWriteFile}`);

  const info = docker(['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) {
    throw new Error(`docker is not available\n${info.stderr || ''}`);
  }

  await startContainer();
  createDatabase();
  bootstrapRolesAndSchemas();
  ensurePgtap();

  log('applying migrations:');
  const files = applyMigrations();
  log(`applied ${files.length} migrations`);

  const suiteOk = runSuites();
  const happyPathOk = runGuardedWriteHappyPath();
  const concurrencyOk = await runConcurrencyPhase();
  process.exitCode = suiteOk && happyPathOk && concurrencyOk ? 0 : 1;
}

/**
 * The guarded-write happy path over committed statements.
 *
 * Every statement here is its own transaction, so the database clock really
 * moves between them. That is the one thing an in-transaction pgTAP file cannot
 * do: `now()` is fixed at the transaction start, and a poll refuses to record an
 * outcome before its window has run out. The vote-and-close sequence that
 * selects a proposal is therefore exercised here, on real committed statements,
 * while the in-transaction suite keeps the branches that do not need a moving
 * clock.
 *
 * Each operation is dispatched through the guard's own whitelist branch, and
 * every step checks the stored row rather than the call alone, so a wrapper that
 * swallowed the mutation could not pass.
 */
function runGuardedWriteHappyPath() {
  log('');
  log('--- guarded write happy path (committed statements, real clock) ---');

  const contact = '00000000-0000-4000-8000-00000000aa01';
  const contributor = '00000000-0000-4000-8000-00000000ab01';
  const person = '00000000-0000-4000-8000-00000000ac01';
  const proposal = '00000000-0000-4000-8000-00000000ad01';
  const poll = '00000000-0000-4000-8000-00000000ae01';
  const revision = '00000000-0000-4000-8000-00000000af01';

  let ok = true;
  const record = (name, passed, detail = '') => {
    log(`RESULT guarded-write-${name} ${passed ? 'PASS' : 'FAIL'} ${detail}`.trimEnd());
    if (!passed) ok = false;
  };

  /** Run one statement as its own transaction; report null on failure. */
  const exec = (sql) => {
    const result = psql(`${sql};`);
    if (result.status !== 0) {
      log(`  SQL failed: ${(result.stderr || '').trim().split('\n')[0] || 'unknown error'}`);
      return null;
    }
    return psqlValue(sql, database);
  };

  /** One guarded call, binding the payload as a jsonb literal. */
  const call = (operation, payload, contactId = contact) =>
    `select public.dev_rein_guarded_write(
       p_operation := '${operation}',
       p_assertion_hash := 'hp-assertion',
       p_caller_id := 'hp-caller',
       p_contact_id := ${contactId === null ? 'null' : `'${contactId}'`},
       p_payload := '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb)`;

  const okOf = (operation, payload, contactId = contact) => {
    const value = exec(`select (${call(operation, payload, contactId)} ->> 'ok')::boolean`);
    return value === 't';
  };

  // ---- Fixtures -----------------------------------------------------------
  const fixtures = [
    `insert into public.dev_community_contacts(id, first_source)
       values ('${contact}', 'manual') on conflict do nothing`,
    `insert into public.dev_contributors(id, contact_id, status)
       values ('${contributor}', '${contact}', 'active') on conflict do nothing`,
    `insert into public.dev_people(id, slug, display_name, person_type, role, contact_id, contributor_id)
       values ('${person}', 'hp-director', 'HP Director', 'director', 'Director',
               '${contact}', '${contributor}') on conflict do nothing`,
    `insert into public.dev_rein_platform_links(
       platform, platform_workspace_id, platform_user_id, platform_channel_id, contact_id,
       status, validity_expires_at, verified_at, verified_by)
       values ('slack', 'W-HP', 'U-HP', 'chan-hp', '${contact}',
               'verified', now() + interval '10 years', now(), 'happy-path-fixture') on conflict do nothing`,
    `insert into public.dev_rein_service_callers(
       caller_id, label, credential_hash, scopes, platform_allowlist, channel_allowlist, created_by, status)
       values ('hp-caller', 'happy path caller', 'hp-credential-hash',
         array['governance.propose', 'governance.poll.open', 'governance.poll.vote',
               'governance.poll.finalize', 'governance.revision.comment',
               'governance.revision.approve', 'governance.revision.apply'],
         '[{"platform":"slack","workspace_id":"W-HP"}]'::jsonb, '["chan-hp"]'::jsonb,
         'happy-path-fixture', 'enabled') on conflict do nothing`,
    `insert into public.dev_rein_ingress_assertions(
       assertion_token_hash, caller_id, platform, platform_workspace_id, platform_user_id,
       platform_channel_id, event_id, source, payload_digest, expires_at)
       values ('hp-assertion', 'hp-caller', 'slack', 'W-HP', 'U-HP', 'chan-hp',
               'hp-event-1', 'relay', 'hp-digest', now() + interval '10 years') on conflict do nothing`,
    `insert into public.dev_rein_vote_types(vote_type, max_candidates, max_approvals_per_voter)
       values ('hp_type', 5, 2) on conflict do nothing`,
  ];
  for (const fixture of fixtures) {
    if (exec(fixture) === null) {
      record('fixture', false);
      return false;
    }
  }

  // ---- 1. submit_proposal ------------------------------------------------
  okOf('submit_proposal', {
    id: proposal,
    proposer_contact_id: contact,
    title: 'A happy path proposal',
    vote_type: 'hp_type',
  });
  record(
    'submit_proposal',
    exec(`select status || '|' || proposer_contact_id || '|' || vote_type
            from public.dev_rein_proposals where id = '${proposal}'`) ===
      `submitted|${contact}|hp_type`,
    'stored row',
  );
  record(
    'submit_proposal-version-1',
    exec(`select count(*) from public.dev_rein_proposal_revisions
           where proposal_id = '${proposal}' and version = 1`) === '1',
    'intake records version 1',
  );

  // ---- 2. create_poll ----------------------------------------------------
  const opensAt = exec('select (now() - interval \'1 second\')::text');
  const closesAt = exec('select (now() + interval \'3 seconds\')::text');
  okOf('create_poll', {
    id: poll,
    creator_contact_id: contact,
    title: 'A happy path poll',
    vote_type: 'hp_type',
    candidate_proposal_ids: [proposal],
    opens_at: opensAt,
    closes_at: closesAt,
  });
  record(
    'create_poll',
    exec(`select candidate_limit || '|' || max_approvals_per_voter || '|' || creator_contact_id
            from public.dev_rein_polls where id = '${poll}'`) === `5|2|${contact}`,
    'limits frozen from the vote type',
  );

  // ---- 3. cast_ballot ----------------------------------------------------
  okOf('cast_ballot', {
    poll_id: poll,
    voter_contact_id: contact,
    approved_proposal_ids: [proposal],
  });
  record(
    'cast_ballot',
    exec(`select voter_contact_id || '|' || cardinality(approved_proposal_ids)
            from public.dev_rein_ballots where poll_id = '${poll}'`) === `${contact}|1`,
    'stored ballot',
  );

  // ---- 4. finalize_poll --------------------------------------------------
  // Every statement above is committed, so the clock has moved; the poll's
  // window is waited out and then the database counts its own winner.
  const untilClose = exec(
    `select greatest(0, ceil(extract(epoch from (
        (select closes_at from public.dev_rein_polls where id = '${poll}') - clock_timestamp()
      ))))::int`,
  );
  if (untilClose !== null && Number(untilClose) > 0) {
    exec(`select pg_sleep(${Number(untilClose) + 1})`);
  }
  okOf('finalize_poll', { poll_id: poll, actor_contact_id: contact });
  record(
    'finalize_poll',
    exec(`select status || '|' || coalesce(winning_proposal_id::text, 'null') || '|' || finalized_by_contact_id
            from public.dev_rein_polls where id = '${poll}'`) === `closed|${proposal}|${contact}`,
    'winner counted by the database',
  );
  record(
    'finalize_poll-selected',
    exec(`select status from public.dev_rein_proposals where id = '${proposal}'`) === 'selected',
    'winner selected',
  );

  // ---- 5. record_proposal_revision --------------------------------------
  okOf('record_proposal_revision', {
    id: revision,
    proposal_id: proposal,
    author_contact_id: contact,
    changed_fields: ['title'],
    title: 'A revised happy path proposal',
    note: 'A wording change',
  });
  record(
    'record_proposal_revision',
    exec(`select author_contact_id || '|' || coalesce(version::text, 'null')
            from public.dev_rein_proposal_revisions where id = '${revision}'`) === `${contact}|null`,
    'stored revision',
  );

  // ---- 6. approve_proposal_revision -------------------------------------
  okOf('approve_proposal_revision', { revision_id: revision, approver_contact_id: contact });
  record(
    'approve_proposal_revision',
    exec(`select coalesce(approved_by_contact_id::text, 'null') || '|' ||
                 (approved_at is not null)::text
            from public.dev_rein_proposal_revisions where id = '${revision}'`) === `${contact}|true`,
    'stored approval',
  );

  // ---- 7. apply_proposal_revision ---------------------------------------
  okOf(
    'apply_proposal_revision',
    { effective_revision_id: revision, title: 'A revised happy path proposal' },
    null,
  );
  record(
    'apply_proposal_revision',
    exec(`select version || '|' || effective_revision_id || '|' || title || '|' || status
            from public.dev_rein_proposals where id = '${proposal}'`) ===
      `2|${revision}|A revised happy path proposal|selected`,
    'trigger assigned version 2',
  );

  log(`guarded write happy path: ${ok ? 'PASSED' : 'FAILED'}`);
  return ok;
}

/**
 * The two-connection phase.
 *
 * A single transaction cannot race itself, so each scenario starts a real psql
 * back end that blocks inside the guarded function while a second connection
 * attempts the same work. The first back end holds its transaction open at a
 * marker, the runner waits for that marker, and only then does the second back
 * end run. Ordering is therefore evidence-based, not timing-based.
 */
async function runConcurrencyPhase() {
  log('');
  log('--- concurrency phase (two real connections) ---');
  if (!existsSync(concurrencyFile)) {
    log('concurrency file missing; skipped');
    return true;
  }

  const seed = psql(readFileSync(concurrencyFile, 'utf8'));
  if (seed.status !== 0) {
    log(`concurrency fixture FAILED (exit ${seed.status})`);
    log((seed.stderr || '').trim());
    return false;
  }

  const results = [];

  results.push(await raceSharedBindingCode());
  results.push(await raceSameTupleDifferentContacts());
  results.push(await revokeThenComplete());
  results.push(await revokeDuringGuardedWrite());

  let ok = true;
  for (const result of results) {
    log(`RESULT ${result.name} ${result.pass ? 'PASS' : 'FAIL'} ${result.detail}`);
    if (!result.pass) ok = false;
  }
  log(`concurrency result: ${ok ? 'PASSED' : 'FAILED'}`);
  return ok;
}

/**
 * Two back ends redeem one binding code at the same time. The first holds an
 * open transaction inside `rein_complete_platform_link`; the second runs while
 * that transaction is still uncommitted, so it must serialize behind the row
 * lock and then observe the consumed code.
 *
 * Expected: exactly one success and exactly one refusal, and exactly one link
 * row for the tuple.
 */
async function raceSharedBindingCode() {
  // Back end A opens a transaction and holds the session row lock inside the
  // guarded function without committing. Back end B then presents the same
  // binding code and blocks on that lock; only after B is provably waiting does
  // A release its transaction. This is a real race, not a sequential replay.
  const held = psqlSession(`
begin;
select * from public.dev_rein_complete_platform_link(
  p_session_token_hash := 'race-tok-shared',
  p_binding_code_hash := 'race-binding-code',
  p_validity := interval '10 years',
  p_platform := 'slack', p_workspace_id := 'W-RACE', p_platform_user_id := 'U-RACE-1',
  p_actor_type := 'system');
select pg_sleep(8);
commit;
`);
  await sleep(1500);

  const blocked = psqlSession(`
select * from public.dev_rein_complete_platform_link(
  p_session_token_hash := 'race-tok-shared',
  p_binding_code_hash := 'race-binding-code',
  p_validity := interval '10 years',
  p_platform := 'slack', p_workspace_id := 'W-RACE', p_platform_user_id := 'U-RACE-1',
  p_actor_type := 'system');
`);
  const observed = await awaitBlockedBackend(15000);
  if (!observed) blocked.kill('SIGKILL');

  const [firstExit, secondExit] = await Promise.all([waitForExit(held, 60000), waitForExit(blocked, 60000)]);

  const firstLinked = /t\|linked\|/.test(firstExit.stdout) || /^linked$/m.test(firstExit.stdout);
  const secondRefused = /f\|binding_already_completed\|/.test(secondExit.stdout);
  const rows = psqlValue(
    `select count(*) from public.dev_rein_platform_links
      where platform = 'slack' and platform_workspace_id = 'W-RACE' and platform_user_id = 'U-RACE-1'`,
    database,
  );

  const pass =
    observed &&
    !firstExit.timedOut &&
    !secondExit.timedOut &&
    firstLinked &&
    secondRefused &&
    Number(rows) === 1;
  return {
    name: 'same-code-redemption',
    pass,
    detail: `observedLock=${observed} first=${firstExit.status} second=${secondExit.status} linked=${firstLinked} refused=${secondRefused} rows=${rows}`,
  };
}

/**
 * Two fully qualified sessions on one platform tuple, each bound to a
 * different contact, complete at the same time. The tuple lock has to let one
 * through and refuse the other, and the tuple must keep the original contact.
 */
async function raceSameTupleDifferentContacts() {
  // Two fully qualified sessions on one tuple, each already bound to a different
  // contact. A holds the tuple lock inside its open transaction; B blocks on it.
  const held = psqlSession(`
begin;
select * from public.dev_rein_complete_platform_link(
  p_session_token_hash := 'race-tok-tuple-a',
  p_binding_code_hash := 'race-binding-tuple-a',
  p_validity := interval '10 years',
  p_platform := 'slack', p_workspace_id := 'W-RACE', p_platform_user_id := 'U-RACE-2',
  p_actor_type := 'system');
select pg_sleep(8);
commit;
`);
  await sleep(1500);

  const blocked = psqlSession(`
select * from public.dev_rein_complete_platform_link(
  p_session_token_hash := 'race-tok-tuple-b',
  p_binding_code_hash := 'race-binding-tuple-b',
  p_validity := interval '10 years',
  p_platform := 'slack', p_workspace_id := 'W-RACE', p_platform_user_id := 'U-RACE-2',
  p_actor_type := 'system');
`);
  const observed = await awaitBlockedBackend(15000);
  if (!observed) blocked.kill('SIGKILL');

  const [firstExit, secondExit] = await Promise.all([waitForExit(held, 60000), waitForExit(blocked, 60000)]);

  const outcomes = [
    /t\|linked\|/.test(firstExit.stdout) || /^linked$/m.test(firstExit.stdout),
    /t\|linked\|/.test(secondExit.stdout) || /^linked$/m.test(secondExit.stdout),
  ];
  const successes = outcomes.filter(Boolean).length;
  const rows = psqlValue(
    `select count(*) from public.dev_rein_platform_links
      where platform = 'slack' and platform_workspace_id = 'W-RACE' and platform_user_id = 'U-RACE-2'`,
    database,
  );
  const kept = psqlValue(
    `select contact_id from public.dev_rein_platform_links
      where platform = 'slack' and platform_workspace_id = 'W-RACE' and platform_user_id = 'U-RACE-2'`,
    database,
  );

  const pass =
    observed &&
    !firstExit.timedOut &&
    !secondExit.timedOut &&
    successes === 1 &&
    Number(rows) === 1 &&
    kept === '00000000-0000-4000-8000-00000000c001';
  return {
    name: 'same-tuple-concurrent',
    pass,
    detail: `observedLock=${observed} first=${firstExit.status} second=${secondExit.status} successes=${successes} rows=${rows} kept=${kept}`,
  };
}

/**
 * A revocation commits before the completion starts, and the refused completion
 * must leave the revoked row in place as a tombstone.
 */
async function revokeThenComplete() {
  // The revocation commits first; the later completion must then refuse and
  // leave the tombstone in place.
  const revoked = psqlValue(
    `select reason from public.dev_rein_revoke_platform_link(
       p_link_id := (select id from public.dev_rein_platform_links
                      where platform='slack' and platform_workspace_id='W-RACE' and platform_user_id='U-RACE-4'),
       p_actor := 'admin:concurrency', p_reason := 'concurrency revocation', p_actor_type := 'system')`,
    database,
  );

  const completion = psqlValue(
    `select reason from public.dev_rein_complete_platform_link(
       p_session_token_hash := 'race-tok-revoke',
       p_binding_code_hash := 'race-binding-revoke',
       p_validity := interval '10 years',
       p_platform := 'slack', p_workspace_id := 'W-RACE', p_platform_user_id := 'U-RACE-4',
       p_actor_type := 'system')`,
    database,
  );

  const status = psqlValue(
    `select status from public.dev_rein_platform_links
      where platform='slack' and platform_workspace_id='W-RACE' and platform_user_id='U-RACE-4'`,
    database,
  );

  const pass = revoked === 'revoked' && completion === 'identity_revoked' && status === 'revoked';
  return {
    name: 'revoke-then-complete',
    pass,
    detail: `revoke=${revoked} completion=${completion} status=${status}`,
  };
}

/**
 * A revocation that commits before the guarded write takes its lock.
 *
 * Back end A opens a transaction, revokes the live link for the race tuple and holds that
 * transaction open on the link row lock. Back end B then calls the guarded write for a proposal that
 * the same tuple would otherwise be allowed to record, and blocks on that lock. Only after B is
 * provably waiting does the runner tell A to commit, so the revocation commits first and B's guard
 * re-reads the link after acquiring the lock and refuses.
 *
 * Expected: the write is refused with `guard_identity_revoked`, no proposal row exists, and the link
 * row is left as the revocation's tombstone.
 */
async function revokeDuringGuardedWrite() {
  const proposalId = '00000000-0000-4000-8000-00000000f001';

  // A holds the revocation open, then commits on the runner's signal.
  const revoking = psqlSession(
    [
      'begin;',
      "select * from public.dev_rein_revoke_platform_link(",
      "  p_link_id := (select id from public.dev_rein_platform_links",
      "                 where platform = 'slack' and platform_workspace_id = 'W-RACE-5'",
      "                   and platform_user_id = 'U-RACE-5'),",
      "  p_actor := 'admin:concurrency', p_reason := 'guarded write revocation', p_actor_type := 'system');",
      "select pg_notify('rein_rein_checkpoint', 'revoked');",
      'select pg_sleep(8);',
      'commit;',
      '',
    ].join('\n'),
  );
  await sleep(1500);

  // B attempts the guarded write while A still holds the transaction open. It blocks on the link
  // row lock, which is exactly the ordering the guard exists to serialize.
  const writing = psqlSession(`
select * from public.dev_rein_guarded_write(
  p_operation := 'submit_proposal',
  p_assertion_hash := 'race-assertion-hash',
  p_caller_id := 'race-caller',
  p_contact_id := '00000000-0000-4000-8000-00000000c003',
  p_payload := jsonb_build_object(
    'id', '${proposalId}',
    'proposer_contact_id', '00000000-0000-4000-8000-00000000c003',
    'title', 'A guarded proposal during a revocation',
    'vote_type', 'race_type'));
`);
  const observed = await awaitBlockedBackend(15000);
  if (!observed) writing.kill('SIGKILL');

  const [revokeExit, writeExit] = await Promise.all([
    waitForExit(revoking, 60000),
    waitForExit(writing, 60000),
  ]);

  const refused = /guard_identity_revoked/.test(writeExit.stdout);
  const proposalRows = psqlValue(
    `select count(*) from public.dev_rein_proposals where id = '${proposalId}'`,
    database,
  );
  const linkStatus = psqlValue(
    `select status from public.dev_rein_platform_links
      where platform = 'slack' and platform_workspace_id = 'W-RACE-5' and platform_user_id = 'U-RACE-5'`,
    database,
  );

  const pass =
    observed &&
    !revokeExit.timedOut &&
    !writeExit.timedOut &&
    refused &&
    Number(proposalRows) === 0 &&
    linkStatus === 'revoked';
  return {
    name: 'revoke-vs-guarded-write',
    pass,
    detail: `observedLock=${observed} revoke=${revokeExit.status} write=${writeExit.status} refused=${refused} proposals=${proposalRows} link=${linkStatus}`,
  };
}

let tornDown = false;
function safeTeardown() {
  if (tornDown) return;
  tornDown = true;
  teardown();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`\nreceived ${signal}`);
    safeTeardown();
    process.exit(1);
  });
}

try {
  await main();
} catch (error) {
  log('');
  log(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  safeTeardown();
}
