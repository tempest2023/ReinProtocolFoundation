import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level tests for the identity, ingress and service-caller HTTP surface.
 *
 * Every database read, RPC, platform signature check and outbound effect is
 * mocked: these tests never reach Supabase, Slack, Discord or the network, and
 * they never send mail. The `server-only` libs are mocked wholesale because that
 * package is only resolved by the Next.js bundler.
 */

const db = vi.hoisted(() => ({
  row: null as unknown,
  selectError: null as unknown,
  rpcResult: null as unknown,
  rpcError: null as unknown,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}))

vi.mock('@/lib/supabase/secret', () => {
  const builder = () => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: db.row, error: db.selectError })
    chain.insert = () => Promise.resolve({ data: null, error: null })
    chain.update = () => chain
    return chain
  }
  return {
    getSecretClient: () => ({
      from: () => builder(),
      rpc: (name: string, args: Record<string, unknown>) => {
        db.rpcCalls.push({ name, args })
        return Promise.resolve({ data: db.rpcResult, error: db.rpcError })
      },
    }),
    requireSecretClient: () => {
      throw new Error('not configured')
    },
  }
})

vi.mock('@/lib/agent/service-callers', () => ({
  authenticateCaller: vi.fn(),
  touchCaller: vi.fn(),
  readCallerHeaders: vi.fn(),
  registerServiceCaller: vi.fn(),
  setServiceCallerStatus: vi.fn(),
}))

vi.mock('@/lib/agent/assertions', () => ({
  validateIngressAssertion: vi.fn(),
  mintIngressAssertion: vi.fn(),
  verifySlackSignature: vi.fn(),
  verifyDiscordSignature: vi.fn(),
  ASSERTION_TTL_MS: 300_000,
  INGRESS_SKEW_SECONDS: 300,
}))

vi.mock('@/lib/identity/linking', () => ({
  resolvePlatformIdentity: vi.fn(),
  issueLinkSession: vi.fn(),
  lookupLinkSession: vi.fn(),
  completePlatformLink: vi.fn(),
  revokePlatformLink: vi.fn(),
  BINDING_VALIDITY: '10 years',
  BINDING_CODE_TTL_MS: 600_000,
}))

vi.mock('@/lib/admin/auth', () => ({ requireAdmin: vi.fn() }))

import { refuse } from '@/lib/agent/contracts'
import { hashValue } from '@/lib/agent/credentials'
import {
  authenticateCaller,
  registerServiceCaller,
  setServiceCallerStatus,
  touchCaller,
} from '@/lib/agent/service-callers'
import {
  mintIngressAssertion,
  validateIngressAssertion,
  verifyDiscordSignature,
  verifySlackSignature,
} from '@/lib/agent/assertions'
import {
  issueLinkSession,
  lookupLinkSession,
  resolvePlatformIdentity,
  revokePlatformLink,
} from '@/lib/identity/linking'
import { requireAdmin } from '@/lib/admin/auth'

import { POST as resolvePost } from '@/app/api/identity/resolve/route'
import { POST as linkStartPost } from '@/app/api/identity/link/start/route'
import { POST as linkStatusPost } from '@/app/api/identity/link/status/route'
import { POST as linkCompletePost } from '@/app/api/identity/link/complete/route'
import { POST as provisionPost } from '@/app/api/admin/service-callers/route'
import { POST as callerStatusPost } from '@/app/api/admin/service-callers/status/route'
import { POST as revokePost } from '@/app/api/admin/identity/revoke/route'
import { POST as relayPost } from '@/app/api/ingress/relay/route'
import { POST as slackPost } from '@/app/api/ingress/slack/events/route'
import { POST as discordPost } from '@/app/api/ingress/discord/interactions/route'

const proof = { kind: 'assertion', assertion: 'ria_test' }
const credentialHeaders = {
  'x-rein-caller-id': 'rein-caller-1',
  authorization: 'Bearer rs_test_value',
}

const baseAssertion = {
  callerId: 'rein-caller-1',
  platform: 'slack',
  workspaceId: 'T1',
  platformUserId: 'U1',
  channelId: 'C1',
  eventId: 'E1',
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function rawRequest(url: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
}

const adminResult = {
  user: { id: 'admin-1', email: 'admin@example.org' },
  service: {},
} as unknown as Awaited<ReturnType<typeof requireAdmin>>

/** Service-caller rows returned by the mocked credential-free lookup. */
const slackCallerRow = {
  caller_id: 'rein-slack-webhook',
  label: 'Slack HTTP webhook',
  scopes: ['ingress.relay'],
  platform_allowlist: [{ platform: 'slack', workspace_id: 'T1' }],
  channel_allowlist: ['C1'],
  status: 'enabled',
}

const discordCallerRow = {
  caller_id: 'rein-discord-webhook',
  label: 'Discord HTTP webhook',
  scopes: ['ingress.relay'],
  platform_allowlist: [{ platform: 'discord', workspace_id: 'G1' }],
  channel_allowlist: ['C1'],
  status: 'enabled',
}

beforeEach(() => {
  vi.clearAllMocks()
  db.row = null
  db.selectError = null
  db.rpcResult = null
  db.rpcError = null
  db.rpcCalls = []
  process.env.REIN_SLACK_SIGNING_SECRET = 'slack-test-secret'
  process.env.REIN_DISCORD_PUBLIC_KEY = 'a'.repeat(64)
  process.env.REIN_SLACK_HTTP_CALLER_ID = 'rein-slack-webhook'
  process.env.REIN_DISCORD_HTTP_CALLER_ID = 'rein-discord-webhook'

  vi.mocked(authenticateCaller).mockResolvedValue({
    ok: true,
    caller: {
      callerId: 'rein-caller-1',
      label: 'Test caller',
      scopes: [],
      platformAllowlist: [
        { platform: 'slack', workspace_id: 'T1' },
        { platform: 'discord', workspace_id: 'G1' },
      ],
      channelAllowlist: ['C1'],
    },
  })
  vi.mocked(touchCaller).mockResolvedValue(undefined)
  vi.mocked(validateIngressAssertion).mockResolvedValue({ ok: true, assertion: { ...baseAssertion } })
  vi.mocked(requireAdmin).mockResolvedValue(adminResult)
})

afterEach(() => {
  delete process.env.REIN_SLACK_SIGNING_SECRET
  delete process.env.REIN_DISCORD_PUBLIC_KEY
  delete process.env.REIN_SLACK_HTTP_CALLER_ID
  delete process.env.REIN_DISCORD_HTTP_CALLER_ID
})

describe('POST /api/identity/resolve', () => {
  const url = 'https://example.test/api/identity/resolve'

  it('refuses a malformed body', async () => {
    const response = await resolvePost(jsonRequest(url, {}, credentialHeaders))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('refuses a body that carries a credential instead of an assertion proof', async () => {
    const response = await resolvePost(
      jsonRequest(url, { proof: { kind: 'caller', credential: 'rs_x' } }, credentialHeaders),
    )
    expect(response.status).toBe(400)
  })

  it('refuses a request with no machine credential', async () => {
    vi.mocked(authenticateCaller).mockResolvedValue(refuse('bad_credential', 401))
    const response = await resolvePost(jsonRequest(url, { proof }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'bad_credential' })
  })

  it('refuses an assertion minted for another caller', async () => {
    vi.mocked(validateIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: { ...baseAssertion, callerId: 'someone-else' },
    })
    const response = await resolvePost(jsonRequest(url, { proof }, credentialHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'caller_unknown' })
  })

  it('refuses a workspace outside the caller allowlist', async () => {
    vi.mocked(validateIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: { ...baseAssertion, workspaceId: 'T-NOT-ALLOWED' },
    })
    const response = await resolvePost(jsonRequest(url, { proof }, credentialHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'platform_not_allowed' })
  })

  it('surfaces an unknown proof as a refusal', async () => {
    vi.mocked(validateIngressAssertion).mockResolvedValue(refuse('proof_unknown', 401))
    const response = await resolvePost(jsonRequest(url, { proof }, credentialHeaders))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'proof_unknown' })
  })

  it('returns the freshly resolved canonical contact', async () => {
    vi.mocked(resolvePlatformIdentity).mockResolvedValue({
      status: 'resolved',
      contactId: 'contact-1',
      isActiveContributor: true,
      isDirector: false,
    })
    const response = await resolvePost(jsonRequest(url, { proof }, credentialHeaders))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: 'resolved',
      contact_id: 'contact-1',
      is_active_contributor: true,
      is_director: false,
    })
  })

  it('reports an unlinked tuple without inventing a contact', async () => {
    vi.mocked(resolvePlatformIdentity).mockResolvedValue({
      status: 'identity_not_linked',
      contactId: null,
      isActiveContributor: false,
      isDirector: false,
    })
    const response = await resolvePost(jsonRequest(url, { proof }, credentialHeaders))
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('identity_not_linked')
    expect(body.contact_id).toBeNull()
  })
})

describe('POST /api/identity/link/start', () => {
  const url = 'https://example.test/api/identity/link/start'

  it('opens a session and returns the website url', async () => {
    vi.mocked(issueLinkSession).mockResolvedValue({
      ok: true,
      session: { sessionToken: 'rls_abc', expiresAt: '2026-10-01T00:00:00.000Z' },
    })
    const response = await linkStartPost(jsonRequest(url, { proof }, credentialHeaders))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      ok: true,
      session_id: 'rls_abc',
      expires_at: '2026-10-01T00:00:00.000Z',
    })
    expect(String(body.verification_url)).toContain('/community/link/rls_abc')
    expect(issueLinkSession).toHaveBeenCalledWith(
      { platform: 'slack', workspaceId: 'T1', platformUserId: 'U1', channelId: 'C1' },
      'rein-caller-1',
    )
  })

  it('maps missing configuration to not_configured', async () => {
    vi.mocked(issueLinkSession).mockResolvedValue({ ok: false, reason: 'not_configured' })
    const response = await linkStartPost(jsonRequest(url, { proof }, credentialHeaders))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'not_configured' })
  })
})

describe('POST /api/identity/link/status', () => {
  const url = 'https://example.test/api/identity/link/status'

  const session = {
    id: 'session-1',
    state: 'email_verified',
    platform: 'slack',
    workspaceId: 'T1',
    platformUserId: 'U1',
    channelId: 'C1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    contactId: 'contact-1',
  }

  it('refuses an unknown session', async () => {
    vi.mocked(lookupLinkSession).mockResolvedValue(null)
    const response = await linkStatusPost(jsonRequest(url, { session_id: 'rls_missing', proof }, credentialHeaders))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('refuses a session that belongs to another platform tuple', async () => {
    vi.mocked(lookupLinkSession).mockResolvedValue({ ...session, platformUserId: 'U-OTHER' })
    const response = await linkStatusPost(jsonRequest(url, { session_id: 'rls_abc', proof }, credentialHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'binding_not_verified' })
  })

  it('reports an expired session', async () => {
    vi.mocked(lookupLinkSession).mockResolvedValue({
      ...session,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    const response = await linkStatusPost(jsonRequest(url, { session_id: 'rls_abc', proof }, credentialHeaders))
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'binding_expired' })
  })

  it('reports an in-flight session without leaking the binding code', async () => {
    vi.mocked(lookupLinkSession).mockResolvedValue(session)
    const response = await linkStatusPost(jsonRequest(url, { session_id: 'rls_abc', proof }, credentialHeaders))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, state: 'email_verified', linked: false, contact_id: null })
    expect(JSON.stringify(body)).not.toMatch(/rein-|binding_code/)
  })

  it('reports registration_required without exposing a contact or binding code', async () => {
    vi.mocked(lookupLinkSession).mockResolvedValue({
      ...session,
      state: 'registration_required',
      contactId: null,
    })
    const response = await linkStatusPost(jsonRequest(url, { session_id: 'rls_abc', proof }, credentialHeaders))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, state: 'registration_required', linked: false, contact_id: null })
    expect(JSON.stringify(body)).not.toMatch(/rein-|binding_code|email/i)
  })
})

describe('POST /api/identity/link/complete', () => {
  const url = 'https://example.test/api/identity/link/complete'

  it('refuses an unknown binding code', async () => {
    db.row = null
    const response = await linkCompletePost(
      jsonRequest(url, { binding_code: 'rein-nope', proof }, credentialHeaders),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'binding_code_invalid' })
  })

  it('refuses a session whose tuple does not match the proof', async () => {
    db.row = {
      session_token_hash: 'hash-of-session',
      platform: 'slack',
      platform_workspace_id: 'T1',
      platform_user_id: 'U-OTHER',
      state: 'email_verified',
    }
    const response = await linkCompletePost(
      jsonRequest(url, { binding_code: 'rein-code', proof }, credentialHeaders),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'binding_not_verified' })
  })

  it('completes with the stored session hash, never the typed code', async () => {
    db.row = {
      session_token_hash: 'hash-of-session',
      platform: 'slack',
      platform_workspace_id: 'T1',
      platform_user_id: 'U1',
      state: 'email_verified',
    }
    db.rpcResult = [
      {
        ok: true,
        reason: 'linked',
        contact_id: 'contact-1',
        link_id: 'link-1',
        platform: 'slack',
        platform_workspace_id: 'T1',
        platform_user_id: 'U1',
      },
    ]
    const response = await linkCompletePost(
      jsonRequest(url, { binding_code: 'rein-code', proof }, credentialHeaders),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      link_id: 'link-1',
      contact_id: 'contact-1',
      platform: 'slack',
      workspace_id: 'T1',
      platform_user_id: 'U1',
    })
    expect(db.rpcCalls).toHaveLength(1)
    const call = db.rpcCalls[0]
    expect(call.name).toBe('rein_complete_platform_link')
    expect(call.args.p_session_token_hash).toBe('hash-of-session')
    expect(call.args.p_binding_code_hash).toBe(hashValue('rein-code'))
    expect(call.args.p_actor_type).toBe('agent')
    expect(call.args.p_platform_user_id).toBe('U1')
  })

  it('maps a revoked tuple to identity_revoked', async () => {
    db.row = {
      session_token_hash: 'hash-of-session',
      platform: 'slack',
      platform_workspace_id: 'T1',
      platform_user_id: 'U1',
      state: 'email_verified',
    }
    db.rpcResult = [{ ok: false, reason: 'identity_revoked' }]
    const response = await linkCompletePost(
      jsonRequest(url, { binding_code: 'rein-code', proof }, credentialHeaders),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'identity_revoked' })
  })
})

describe('POST /api/admin/service-callers', () => {
  const url = 'https://example.test/api/admin/service-callers'

  const provisionBody = {
    caller_id: 'rein-agent-dev',
    label: 'Rein Agent development caller',
    scopes: ['governance.read', 'ingress.relay'],
    platform_allowlist: [{ platform: 'slack', workspace_id: 'T1' }],
    channel_allowlist: ['C1'],
  }

  it('refuses a caller that is not an administrator', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('redirect to login'))
    await expect(provisionPost(jsonRequest(url, provisionBody))).rejects.toThrow('redirect to login')
  })

  it('refuses an unknown scope', async () => {
    const response = await provisionPost(
      jsonRequest(url, { ...provisionBody, scopes: ['governance.read', 'root.everything'] }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('refuses a malformed platform allowlist entry', async () => {
    const response = await provisionPost(
      jsonRequest(url, { ...provisionBody, platform_allowlist: [{ platform: 'slack' }] }),
    )
    expect(response.status).toBe(400)
  })

  it('issues a credential once and passes the admin as creator', async () => {
    vi.mocked(registerServiceCaller).mockResolvedValue({ ok: true, credential: 'rs_new_credential' })
    const response = await provisionPost(jsonRequest(url, provisionBody))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      caller_id: 'rein-agent-dev',
      credential: 'rs_new_credential',
    })
    expect(registerServiceCaller).toHaveBeenCalledWith(
      expect.objectContaining({ callerId: 'rein-agent-dev', createdBy: 'admin@example.org' }),
    )
  })

  it('maps a duplicate caller id to a conflict', async () => {
    vi.mocked(registerServiceCaller).mockResolvedValue(refuse('invalid_request', 409))
    const response = await provisionPost(jsonRequest(url, provisionBody))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })
})

describe('POST /api/admin/service-callers/status', () => {
  const url = 'https://example.test/api/admin/service-callers/status'

  it('refuses an unknown caller', async () => {
    db.row = null
    const response = await callerStatusPost(jsonRequest(url, { caller_id: 'rein-missing', status: 'revoked' }))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('refuses a status value outside the enum', async () => {
    const response = await callerStatusPost(jsonRequest(url, { caller_id: 'rein-agent-dev', status: 'disabled' }))
    expect(response.status).toBe(400)
  })

  it('updates the status of an existing caller', async () => {
    db.row = { caller_id: 'rein-agent-dev' }
    vi.mocked(setServiceCallerStatus).mockResolvedValue({ ok: true })
    const response = await callerStatusPost(jsonRequest(url, { caller_id: 'rein-agent-dev', status: 'revoked' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      caller_id: 'rein-agent-dev',
      status: 'revoked',
    })
    expect(setServiceCallerStatus).toHaveBeenCalledWith('rein-agent-dev', 'revoked', 'admin@example.org')
  })
})

describe('POST /api/admin/identity/revoke', () => {
  const url = 'https://example.test/api/admin/identity/revoke'
  const linkId = '11111111-2222-3333-4444-555555555555'

  it('requires a reason', async () => {
    const response = await revokePost(jsonRequest(url, { link_id: linkId, reason: 'no' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('requires a well-formed link id', async () => {
    const response = await revokePost(jsonRequest(url, { link_id: 'not-a-uuid', reason: 'requested by owner' }))
    expect(response.status).toBe(400)
  })

  it('revokes a binding and reports the outcome', async () => {
    vi.mocked(revokePlatformLink).mockResolvedValue({ ok: true, reason: 'revoked', contactId: 'contact-1' })
    const response = await revokePost(jsonRequest(url, { link_id: linkId, reason: 'requested by owner' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      link_id: linkId,
      reason: 'revoked',
      contact_id: 'contact-1',
    })
    expect(revokePlatformLink).toHaveBeenCalledWith({
      linkId,
      actor: 'admin@example.org',
      reason: 'requested by owner',
      actorType: 'admin',
    })
  })

  it('maps a missing link to 404', async () => {
    vi.mocked(revokePlatformLink).mockResolvedValue({ ok: false, reason: 'link_not_found' })
    const response = await revokePost(jsonRequest(url, { link_id: linkId, reason: 'requested by owner' }))
    expect(response.status).toBe(404)
  })
})

describe('POST /api/ingress/relay', () => {
  const url = 'https://example.test/api/ingress/relay'

  const body = {
    platform: 'slack',
    workspace_id: 'T1',
    platform_user_id: 'U1',
    channel_id: 'C1',
    event_id: 'E1',
    event_ts: String(Math.floor(Date.now() / 1000)),
  }

  it('refuses an event outside the replay window', async () => {
    const response = await relayPost(
      jsonRequest(url, { ...body, event_ts: '2000-01-01T00:00:00.000Z' }, credentialHeaders),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'invalid_request' })
  })

  it('refuses a workspace outside the caller allowlist', async () => {
    const response = await relayPost(
      jsonRequest(url, { ...body, workspace_id: 'T-NOT-ALLOWED' }, credentialHeaders),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'platform_not_allowed' })
  })

  it('refuses a caller without the ingress scope', async () => {
    vi.mocked(authenticateCaller).mockResolvedValue(refuse('scope_missing', 403))
    const response = await relayPost(jsonRequest(url, body, credentialHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'scope_missing' })
  })

  it('mints a short-lived relay assertion bound to the caller', async () => {
    vi.mocked(mintIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: 'ria_relay',
      expiresAt: '2026-10-01T00:05:00.000Z',
    })
    const response = await relayPost(jsonRequest(url, body, credentialHeaders))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      ok: true,
      assertion: 'ria_relay',
      expires_at: '2026-10-01T00:05:00.000Z',
    })
    expect(mintIngressAssertion).toHaveBeenCalledWith(
      expect.objectContaining({
        callerId: 'rein-caller-1',
        platform: 'slack',
        workspaceId: 'T1',
        platformUserId: 'U1',
        channelId: 'C1',
        eventId: 'E1',
        source: 'relay',
      }),
    )
  })

  it('surfaces a repeated event as event_already_asserted', async () => {
    vi.mocked(mintIngressAssertion).mockResolvedValue(refuse('event_already_asserted', 409))
    const response = await relayPost(jsonRequest(url, body, credentialHeaders))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'event_already_asserted' })
  })
})

describe('POST /api/ingress/slack/events', () => {
  const url = 'https://example.test/api/ingress/slack/events'
  const slackHeaders = { 'x-slack-request-timestamp': '1727472000', 'x-slack-signature': 'v0=deadbeef' }

  const eventBody = JSON.stringify({
    type: 'event_callback',
    team_id: 'T1',
    event_id: 'Ev1',
    event: { type: 'app_mention', user: 'U1', channel: 'C1', text: 'hello' },
  })

  it('refuses when no signing secret is configured', async () => {
    delete process.env.REIN_SLACK_SIGNING_SECRET
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'not_configured' })
  })

  it('refuses a delivery with a bad signature', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(false)
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'bad_credential' })
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('answers the url_verification handshake after the signature check', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    const response = await slackPost(
      rawRequest(url, JSON.stringify({ type: 'url_verification', challenge: 'challenge-token' }), slackHeaders),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ challenge: 'challenge-token' })
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('refuses a direct Slack event when no enrolled caller is configured', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    delete process.env.REIN_SLACK_HTTP_CALLER_ID
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'not_configured' })
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('refuses a direct Slack event whose configured caller is unknown', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    db.row = null
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'caller_unknown' })
  })

  it('refuses a direct Slack event from a revoked caller', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    db.row = { ...slackCallerRow, status: 'revoked' }
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'caller_revoked' })
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('refuses a direct Slack event from a caller without the ingress scope', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    db.row = { ...slackCallerRow, scopes: ['governance.read'] }
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'scope_missing' })
  })

  it('refuses a direct Slack event whose channel is outside the allowlist', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    db.row = { ...slackCallerRow, channel_allowlist: ['C-SOMEWHERE-ELSE'] }
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'channel_not_allowed' })
  })

  it('accepts a direct Slack event with no service headers and answers the provider', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    db.row = slackCallerRow
    vi.mocked(mintIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: 'ria_slack',
      expiresAt: '2026-10-01T00:05:00.000Z',
    })
    const response = await slackPost(rawRequest(url, eventBody, slackHeaders))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, expires_at: '2026-10-01T00:05:00.000Z' })
    expect(authenticateCaller).not.toHaveBeenCalled()
    expect(mintIngressAssertion).toHaveBeenCalledWith(
      expect.objectContaining({
        callerId: 'rein-slack-webhook',
        platform: 'slack',
        workspaceId: 'T1',
        platformUserId: 'U1',
        channelId: 'C1',
        eventId: 'Ev1',
        source: 'http_signature',
      }),
    )
  })

  it('honours an explicit forwarded caller and returns the proof', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    vi.mocked(mintIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: 'ria_slack',
      expiresAt: '2026-10-01T00:05:00.000Z',
    })
    const response = await slackPost(rawRequest(url, eventBody, { ...slackHeaders, ...credentialHeaders }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      assertion: 'ria_slack',
      expires_at: '2026-10-01T00:05:00.000Z',
    })
    expect(mintIngressAssertion).toHaveBeenCalledWith(
      expect.objectContaining({ callerId: 'rein-caller-1', source: 'http_signature' }),
    )
  })

  it('refuses a forwarded credential that does not authenticate', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    vi.mocked(authenticateCaller).mockResolvedValue(refuse('bad_credential', 401))
    const response = await slackPost(rawRequest(url, eventBody, { ...slackHeaders, ...credentialHeaders }))
    expect(response.status).toBe(401)
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('refuses an event that names no user', async () => {
    vi.mocked(verifySlackSignature).mockReturnValue(true)
    const noUser = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev2',
      event: { type: 'message', channel: 'C1' },
    })
    const response = await slackPost(rawRequest(url, noUser, slackHeaders))
    expect(response.status).toBe(400)
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })
})

describe('POST /api/ingress/discord/interactions', () => {
  const url = 'https://example.test/api/ingress/discord/interactions'
  const discordHeaders = { 'x-signature-timestamp': '1727472000', 'x-signature-ed25519': 'ab'.repeat(64) }

  it('refuses a bad signature', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(false)
    const response = await discordPost(rawRequest(url, JSON.stringify({ type: 1 }), discordHeaders))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'bad_credential' })
  })

  it('answers a PING after the signature check', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(true)
    const response = await discordPost(rawRequest(url, JSON.stringify({ type: 1 }), discordHeaders))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ type: 1 })
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('refuses a direct interaction when no enrolled caller is configured', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(true)
    delete process.env.REIN_DISCORD_HTTP_CALLER_ID
    const interaction = JSON.stringify({
      id: 'I0',
      type: 2,
      guild_id: 'G1',
      channel_id: 'C1',
      member: { user: { id: 'U1' } },
    })
    const response = await discordPost(rawRequest(url, interaction, discordHeaders))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'not_configured' })
    expect(mintIngressAssertion).not.toHaveBeenCalled()
  })

  it('accepts a direct interaction with no service headers and answers the provider', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(true)
    db.row = discordCallerRow
    vi.mocked(mintIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: 'ria_discord',
      expiresAt: '2026-10-01T00:05:00.000Z',
    })
    const interaction = JSON.stringify({
      id: 'I1',
      type: 2,
      guild_id: 'G1',
      channel_id: 'C1',
      member: { user: { id: 'U1' } },
    })
    const response = await discordPost(rawRequest(url, interaction, discordHeaders))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ type: 5 })
    expect(authenticateCaller).not.toHaveBeenCalled()
    expect(mintIngressAssertion).toHaveBeenCalledWith(
      expect.objectContaining({
        callerId: 'rein-discord-webhook',
        platform: 'discord',
        workspaceId: 'G1',
        platformUserId: 'U1',
        channelId: 'C1',
        eventId: 'I1',
        source: 'http_signature',
      }),
    )
  })

  it('honours an explicit forwarded caller and returns the proof', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(true)
    vi.mocked(mintIngressAssertion).mockResolvedValue({
      ok: true,
      assertion: 'ria_discord',
      expiresAt: '2026-10-01T00:05:00.000Z',
    })
    const interaction = JSON.stringify({
      id: 'I3',
      type: 2,
      guild_id: 'G1',
      channel_id: 'C1',
      member: { user: { id: 'U1' } },
    })
    const response = await discordPost(rawRequest(url, interaction, { ...discordHeaders, ...credentialHeaders }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      assertion: 'ria_discord',
      expires_at: '2026-10-01T00:05:00.000Z',
    })
  })

  it('refuses a direct interaction whose guild is outside the allowlist', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(true)
    db.row = discordCallerRow
    const interaction = JSON.stringify({
      id: 'I2',
      type: 2,
      guild_id: 'G-NOT-ALLOWED',
      channel_id: 'C1',
      member: { user: { id: 'U1' } },
    })
    const response = await discordPost(rawRequest(url, interaction, discordHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'platform_not_allowed' })
  })

  it('refuses a direct interaction from a revoked caller', async () => {
    vi.mocked(verifyDiscordSignature).mockReturnValue(true)
    db.row = { ...discordCallerRow, status: 'revoked' }
    const interaction = JSON.stringify({
      id: 'I4',
      type: 2,
      guild_id: 'G1',
      channel_id: 'C1',
      member: { user: { id: 'U1' } },
    })
    const response = await discordPost(rawRequest(url, interaction, discordHeaders))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'caller_revoked' })
  })
})
