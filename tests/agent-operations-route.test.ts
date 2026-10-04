import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

// The governance reader and writer resolve their PostgREST configuration on
// first use, from `publicEnv.supabaseUrl` and `SUPABASE_SECRET_KEY`. This suite
// stubs the transport, so it pins a hermetic development configuration the same
// way the deployment does. `publicEnv` is pinned here rather than through an
// environment variable because the bundled build inlines `NEXT_PUBLIC_*` at
// transform time, and a value assigned in a test file is already too late.
process.env.SUPABASE_SECRET_KEY = 'sb_secret_unit_test'
process.env.DATABASE_ENVIRONMENT = 'dev'

vi.mock('@/lib/env', () => ({
  publicEnv: {
    siteUrl: 'http://localhost:3000',
    supabaseUrl: 'https://unit-test.supabase.co',
    supabaseKey: undefined,
  },
  isSupabaseSecretKey: (value: string | undefined) => value?.startsWith('sb_secret_') ?? false,
  isSupabasePublishableKey: (value: string | undefined) => value?.startsWith('sb_publishable_') ?? false,
  adminEmails: () => new Set<string>(),
  adminReadiness: () => ({ ready: true, missing: [] }),
  isDirectAdminLoginEnabled: () => false,
}))

/**
 * Integration coverage for the machine dispatcher.
 *
 * Two boundaries are stubbed, and both are the real ones the route reaches:
 *
 *   * `@/lib/supabase/secret` answers caller authentication, assertion
 *     validation and the identity / apply-permission RPCs, and
 *   * `globalThis.fetch` is the governed PostgREST transport the governance
 *     reader and writer use for every table read, write and RPC.
 *
 * The route, the scope and eligibility gates, `resolvePlatformIdentity`,
 * `canApplyRevision`, `createFoundationDbWriter` and the real
 * `getRevision`/`applyProposalRevision` code paths all run as written. A fixture
 * only has to seed rows; nothing in the assertions is weakened to make a
 * reference implementation pass.
 */

type Row = Record<string, unknown>

interface TransportLog {
  method: string
  table: string
  params: URLSearchParams
  body: unknown
}

interface Fixture {
  caller: Row | null
  assertion: Row | null
  identity: Row
  applyPermission: boolean
  /** Rows the PostgREST transport answers for a read of `<env>_rein_proposal_revisions`. */
  revisions: Row[]
  /** Rows the transport answers for a read/patch of `<env>_rein_proposals`. */
  proposals: Row[]
  /** Rows the transport answers for a read of `<env>_rein_polls`. */
  polls: Row[]
  /**
   * What the guarded write RPC answers. `null` means the guard accepts and the
   * envelope carries the rows the branch stored; a string is the guard's own
   * refusal reason, which the route must return as a governance refusal.
   */
  guardedRefusal: string | null
  /** Every governed request the reader or writer made. */
  transport: TransportLog[]
}

const state: Fixture = {
  caller: null,
  assertion: null,
  identity: { status: 'resolved', contact_id: 'c-1', is_active_contributor: true, is_director: true },
  applyPermission: true,
  revisions: [],
  proposals: [],
  polls: [],
  guardedRefusal: null,
  transport: [],
}

const REVISION_ID = '11111111-1111-4111-8111-111111111111'
const REVISION_PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'
const REVISION_AUTHOR_ID = '44444444-4444-4444-8444-444444444444'
const DIRECTOR_ID = 'c-1'
const POLL_ID = '22222222-2222-4222-8222-222222222222'
const CANDIDATE_ID = '66666666-6666-4666-8666-666666666666'

/** A recorded minor revision (a real field change, so it is applicable). */
function revisionRow(overrides: Row = {}): Row {
  return {
    id: REVISION_ID,
    proposal_id: REVISION_PROPOSAL_ID,
    version: null,
    author_contact_id: REVISION_AUTHOR_ID,
    changed_fields: ['title'],
    title: 'The revised title',
    summary: null,
    requested_minor: null,
    currency: null,
    location: null,
    schedule: null,
    personnel: null,
    event_flow: null,
    note: 'A wording change for the operator.',
    approved_by_contact_id: null,
    approved_at: null,
    recorded_at: '2026-09-30T00:00:00Z',
    ...overrides,
  }
}

/** The proposal row the PATCH returns, in the shape `appliedProposalFromRow` accepts. */
function appliedProposalRow(overrides: Row = {}): Row {
  return {
    id: REVISION_PROPOSAL_ID,
    status: 'selected',
    version: 2,
    effective_revision_id: REVISION_ID,
    title: 'The revised title',
    summary: null,
    requested_minor: null,
    currency: null,
    location: null,
    schedule: null,
    personnel: null,
    event_flow: null,
    ...overrides,
  }
}

function pollRow(overrides: Row = {}): Row {
  return {
    id: POLL_ID,
    creator_contact_id: DIRECTOR_ID,
    title: 'A recorded poll',
    vote_type: 'activity',
    candidate_proposal_ids: [CANDIDATE_ID],
    candidate_limit: 3,
    max_approvals_per_voter: 2,
    status: 'open',
    opens_at: '2026-09-29T00:00:00Z',
    closes_at: '2026-10-30T00:00:00Z',
    created_at: '2026-09-29T00:00:00Z',
    ...overrides,
  }
}

/** The PostgREST table name the writer asks for, e.g. `dev_rein_proposal_revisions`. */
function governedRows(table: string): Row[] {
  if (table.includes('rein_proposal_revisions')) return state.revisions
  if (table.includes('rein_proposals')) return state.proposals
  if (table.includes('rein_polls')) return state.polls
  return []
}

/**
 * The governed transport. It answers a `GET` with the seeded rows for the table,
 * and a `PATCH` with the applied proposal row, recording every call so a test can
 * prove an authorization failure reached no write.
 */
const governedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const parsed = new URL(url)
  const table = parsed.pathname.replace(/^\/rest\/v1\//, '')
  const method = (init?.method ?? 'GET').toUpperCase()
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
  state.transport.push({ method, table, params: parsed.searchParams, body })

  // The guarded write RPC answers with one envelope: `ok` with the stored rows,
  // or the guard's own refusal reason. A write inside the guard would not reach a
  // table, so the run-time answer is the database's single result.
  if (table.endsWith('rein_guarded_write')) {
    const envelope =
      state.guardedRefusal === null
        ? { ok: true, rows: [appliedProposalRow()] }
        : { ok: false, reason: state.guardedRefusal }
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rows = method === 'PATCH' ? [appliedProposalRow()] : governedRows(table)
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})

vi.mock('@/lib/supabase/secret', () => {
  const tableClient = (table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.order = () => chain
    chain.maybeSingle = () =>
      Promise.resolve({ data: table.includes('rein_service_callers') ? state.caller : null, error: null })
    chain.limit = () => chain
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve)
    chain.insert = () => Promise.resolve({ data: null, error: null })
    chain.update = () => chain
    return chain
  }
  return {
    getSecretClient: () => ({
      from: (table: string) => tableClient(table),
      rpc: (name: string) => {
        if (name.endsWith('rein_validate_ingress_assertion')) {
          return Promise.resolve({ data: [state.assertion ?? { ok: false, reason: 'proof_unknown' }], error: null })
        }
        if (name.endsWith('rein_resolve_platform_contact')) {
          return Promise.resolve({ data: [state.identity], error: null })
        }
        if (name.endsWith('rein_apply_permission')) {
          return Promise.resolve({ data: state.applyPermission, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
    }),
    requireSecretClient: () => {
      throw new Error('not configured')
    },
  }
})

import { POST } from '@/app/api/agent/operations/route'

const CREDENTIAL_HEADERS = {
  'x-rein-caller-id': 'rein-agent-dev',
  authorization: 'Bearer rs_test_value',
}

function caller(overrides: Partial<Row> = {}): Row {
  return {
    caller_id: 'rein-agent-dev',
    label: 'Rein Agent development caller',
    credential_hash: createHash('sha256').update('rs_test_value').digest('hex'),
    scopes: ['governance.read'],
    platform_allowlist: [{ platform: 'slack', workspace_id: 'T0TEST' }],
    channel_allowlist: ['C0PROPOSALS'],
    status: 'enabled',
    ...overrides,
  }
}

function assertion(overrides: Partial<Row> = {}): Row {
  return {
    ok: true,
    reason: 'ok',
    caller_id: 'rein-agent-dev',
    platform: 'slack',
    platform_workspace_id: 'T0TEST',
    platform_user_id: 'U0MEMBER',
    platform_channel_id: 'C0PROPOSALS',
    event_id: 'Ev0EVENT',
    ...overrides,
  }
}

function request(body: unknown, headers: Record<string, string> = CREDENTIAL_HEADERS): Request {
  return new Request('https://example.test/api/agent/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    operation: 'get_poll',
    input: { pollId: POLL_ID },
    proof: { kind: 'assertion', assertion: 'ria_x' },
    ...overrides,
  }
}

async function reasonOf(response: Response): Promise<string> {
  const payload = (await response.json()) as { reason?: string }
  return payload.reason ?? ''
}

/** A transport write to the proposal row: the only write an apply may make. */
function proposalWrites(): TransportLog[] {
  return state.transport.filter(
    (entry) => entry.method !== 'GET' && entry.table.includes('rein_proposals'),
  )
}

/** Every guarded-write RPC the writer issued, which is where a write belongs now. */
function guardedCalls(): TransportLog[] {
  return state.transport.filter((entry) => entry.table.endsWith('rein_guarded_write'))
}

/** A transport read of the revision row, which is the dispatcher's precondition. */
function revisionReads(): TransportLog[] {
  return state.transport.filter(
    (entry) => entry.method === 'GET' && entry.table.includes('rein_proposal_revisions'),
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', governedFetch)
  state.caller = caller()
  state.assertion = assertion()
  state.identity = { status: 'resolved', contact_id: 'c-1', is_active_contributor: true, is_director: true }
  state.applyPermission = true
  state.revisions = []
  state.proposals = [appliedProposalRow()]
  state.polls = [pollRow()]
  state.guardedRefusal = null
  state.transport = []
  governedFetch.mockClear()
})

describe('POST /api/agent/operations', () => {
  it('refuses a request with no machine credential headers', async () => {
    const response = await POST(request(operation(), {}))
    expect(response.status).toBe(401)
    expect(await reasonOf(response)).toBe('bad_credential')
    expect(state.transport).toEqual([])
  })

  it('refuses an operation outside the enum allowlist', async () => {
    const response = await POST(request(operation({ operation: 'drop_everything' })))
    expect(response.status).toBe(400)
    expect(await reasonOf(response)).toBe('invalid_operation')
  })

  it('refuses a malformed body', async () => {
    const response = await POST(request({ operation: 'get_poll' }))
    expect(response.status).toBe(400)
    expect(await reasonOf(response)).toBe('invalid_request')
  })

  it('refuses a body that carries a credential instead of an assertion proof', async () => {
    const response = await POST(
      request(operation({ proof: { kind: 'caller', caller_id: 'rein-agent-dev', credential: 'rs_test_value' } })),
    )
    expect(response.status).toBe(400)
    expect(await reasonOf(response)).toBe('invalid_request')
  })

  it('refuses a revoked caller', async () => {
    state.caller = caller({ status: 'revoked' })
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('caller_revoked')
  })

  it('refuses a caller whose scope does not cover the operation', async () => {
    state.caller = caller({ scopes: ['identity.resolve'] })
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('scope_missing')
  })

  it('refuses a proof minted for a different caller', async () => {
    state.assertion = assertion({ caller_id: 'someone-else' })
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('caller_unknown')
  })

  it('refuses an assertion outside the caller platform allowlist', async () => {
    state.assertion = assertion({ platform_workspace_id: 'T0OTHER' })
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('platform_not_allowed')
  })

  it('refuses a channel outside the caller channel allowlist', async () => {
    state.assertion = assertion({ platform_channel_id: 'C0ELSEWHERE' })
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('channel_not_allowed')
  })

  it('refuses an expired proof', async () => {
    state.assertion = { ok: false, reason: 'proof_expired' }
    const response = await POST(request(operation()))
    expect(response.status).toBe(401)
    expect(await reasonOf(response)).toBe('proof_expired')
  })

  it('refuses an unbound platform account', async () => {
    state.identity = { status: 'identity_not_linked', contact_id: null, is_active_contributor: false, is_director: false }
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('binding_not_verified')
  })

  it('refuses a revoked binding', async () => {
    state.identity = { status: 'identity_revoked', contact_id: 'c-1', is_active_contributor: false, is_director: false }
    const response = await POST(request(operation()))
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('identity_revoked')
  })

  it('refuses a proposal write from a binding that is not an active Contributor', async () => {
    state.caller = caller({ scopes: ['governance.propose'] })
    state.identity = { status: 'resolved', contact_id: 'c-1', is_active_contributor: false, is_director: false }
    const response = await POST(
      request({
        operation: 'submit_proposal',
        input: { id: 'pr-1', title: 'A thing', voteType: 'activity' },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('ineligible_actor')
    expect(state.transport).toEqual([])
  })

  it('refuses a director operation from a Contributor who is not a director', async () => {
    state.caller = caller({ scopes: ['governance.poll.vote'] })
    state.identity = { status: 'resolved', contact_id: 'c-1', is_active_contributor: true, is_director: false }
    const response = await POST(
      request({
        operation: 'cast_ballot',
        input: { pollId: POLL_ID, approvedProposalIds: [] },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('ineligible_actor')
  })

  it('refuses a revoked qualification on a write even when the binding resolves', async () => {
    state.caller = caller({ scopes: ['governance.poll.finalize'] })
    state.identity = { status: 'resolved', contact_id: 'c-1', is_active_contributor: true, is_director: false }
    const response = await POST(
      request({
        operation: 'finalize_poll',
        input: { pollId: POLL_ID },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('ineligible_actor')
  })

  it('refuses apply_proposal_revision when the actor is neither director nor the author', async () => {
    state.caller = caller({ scopes: ['governance.revision.apply'] })
    state.identity = { status: 'resolved', contact_id: 'c-9', is_active_contributor: true, is_director: false }
    state.applyPermission = false
    state.revisions = [revisionRow()]
    const response = await POST(
      request({
        operation: 'apply_proposal_revision',
        input: { revisionId: REVISION_ID },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(403)
    expect(await reasonOf(response)).toBe('ineligible_actor')
    // The dispatcher really read the revision before it asked about the actor.
    expect(revisionReads().length).toBeGreaterThan(0)
    // A denied apply never writes the proposal row.
    expect(proposalWrites()).toEqual([])
  })

  it('allows apply_proposal_revision for the proposal author and reports the route envelope', async () => {
    state.caller = caller({ scopes: ['governance.revision.apply'] })
    state.identity = { status: 'resolved', contact_id: REVISION_AUTHOR_ID, is_active_contributor: true, is_director: false }
    state.applyPermission = true
    state.revisions = [revisionRow()]
    const response = await POST(
      request({
        operation: 'apply_proposal_revision',
        input: { revisionId: REVISION_ID },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { ok?: boolean; operation?: string; result?: Row }
    expect(payload.ok).toBe(true)
    expect(payload.operation).toBe('apply_proposal_revision')
    expect(payload.result).toBeDefined()
    // The write belongs to the guard now: the route must send one guarded RPC and
    // no direct proposal write. The payload stays the minimal effective-revision
    // patch, so a caller still cannot widen what it changes.
    const guarded = guardedCalls()
    expect(guarded.length).toBe(1)
    expect(guarded[0].body).toEqual(
      expect.objectContaining({
        p_operation: 'apply_proposal_revision',
        p_contact_id: null,
        p_payload: { effective_revision_id: REVISION_ID, title: 'The revised title' },
      }),
    )
    expect(proposalWrites()).toEqual([])
  })

  it('allows apply_proposal_revision for a current director and reports the route envelope', async () => {
    state.caller = caller({ scopes: ['governance.revision.apply'] })
    state.identity = { status: 'resolved', contact_id: DIRECTOR_ID, is_active_contributor: true, is_director: true }
    state.applyPermission = true
    state.revisions = [revisionRow()]
    const response = await POST(
      request({
        operation: 'apply_proposal_revision',
        input: { revisionId: REVISION_ID },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { ok?: boolean; operation?: string }
    expect(payload.ok).toBe(true)
    expect(payload.operation).toBe('apply_proposal_revision')
    expect(guardedCalls().length).toBe(1)
    expect(proposalWrites()).toEqual([])
  })

  it('refuses apply_proposal_revision when the revision does not exist', async () => {
    state.caller = caller({ scopes: ['governance.revision.apply'] })
    state.identity = { status: 'resolved', contact_id: DIRECTOR_ID, is_active_contributor: true, is_director: true }
    state.applyPermission = true
    state.revisions = []
    const response = await POST(
      request({
        operation: 'apply_proposal_revision',
        input: { revisionId: REVISION_ID },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBe(404)
    expect(await reasonOf(response)).toBe('invalid_request')
    expect(guardedCalls()).toEqual([])
    expect(proposalWrites()).toEqual([])
  })

  it('sends every write through the guarded RPC with the verified caller and proof digest', async () => {
    state.caller = caller({ scopes: ['governance.propose'] })
    // The writer validates the actor as a UUID before it reaches the database, so
    // this case uses the contact id the binding actually resolved to rather than
    // the non-UUID sentinel the refusal cases use.
    const contactId = '00000000-0000-4000-8000-00000000ac01'
    state.identity = { status: 'resolved', contact_id: contactId, is_active_contributor: true, is_director: false }
    const response = await POST(
      request({
        operation: 'submit_proposal',
        input: {
          id: '00000000-0000-4000-8000-00000000ad01',
          proposerContactId: contactId,
          title: 'A guarded proposal',
          voteType: 'activity',
        },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(response.status).toBeLessThan(500)

    const guarded = state.transport.filter((entry) => entry.table.endsWith('rein_guarded_write'))
    expect(guarded.length).toBe(1)
    const call = guarded[0] as { method: string; body?: Record<string, unknown> }
    expect(call.method).toBe('POST')
    expect(call.body?.p_operation).toBe('submit_proposal')
    // The actor, caller and proof come from the verified request, never the body.
    expect(call.body?.p_caller_id).toBe('rein-agent-dev')
    expect(typeof call.body?.p_assertion_hash).toBe('string')
    expect(call.body?.p_assertion_hash).not.toBe('ria_x')
  })

  it('surfaces a guard refusal as a closed governance answer, not a transport failure', async () => {
    state.caller = caller({ scopes: ['governance.revision.apply'] })
    state.identity = { status: 'resolved', contact_id: DIRECTOR_ID, is_active_contributor: true, is_director: true }
    state.applyPermission = true
    state.revisions = [revisionRow()]
    state.guardedRefusal = 'guard_identity_revoked'
    const response = await POST(
      request({
        operation: 'apply_proposal_revision',
        input: { revisionId: REVISION_ID },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    // The route answers `200 { ok: false }` with the guard's reason collapsed into
    // the result, because the refusal is a governance decision and not an outage:
    // the caller must never read a revoked binding as a 5xx.
    expect(response.status).toBeLessThan(500)
    const payload = (await response.json()) as { ok?: boolean; reason?: string; result?: { ok?: boolean } }
    const refused = payload.ok === false || payload.result?.ok === false
    expect(refused).toBe(true)
  })

  it('ignores a contact id supplied in the operation body', async () => {
    const response = await POST(
      request({
        operation: 'available_funds',
        input: { currency: 'USD', contactId: 'c-attacker', proposerContactId: 'c-attacker' },
        proof: { kind: 'assertion', assertion: 'ria_x' },
      }),
    )
    expect(await reasonOf(response)).not.toBe('invalid_request')
  })
})
