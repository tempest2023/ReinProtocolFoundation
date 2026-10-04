import { describe, expect, it, vi } from 'vitest'

/**
 * Server-action coverage for the website side of account linking.
 *
 * The domain layer is mocked so the test proves the form contract and the
 * action's own decisions: which fields it reads, that a receipt link is never
 * consumed by rendering, and that a confirmed address returns the channel
 * binding code to the browser.
 */

const domain = vi.hoisted(() => ({
  requestLinkEmail: vi.fn(),
  confirmLinkEmail: vi.fn(),
  lookupLinkSession: vi.fn(),
  issueEmailChallenge: vi.fn(),
  confirmLinkEmailDomain: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}))

vi.mock('@/lib/email', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue({ id: 'email_1' }),
}))

vi.mock('@/lib/identity/linking', () => ({
  issueEmailChallenge: domain.issueEmailChallenge,
  lookupLinkSession: domain.lookupLinkSession,
  confirmLinkEmail: domain.confirmLinkEmailDomain,
}))

import { sendTransactionalEmail } from '@/lib/email'
import { confirmLinkEmail, requestLinkEmail, type LinkFormState } from '@/lib/identity/link-actions'

const IDLE: LinkFormState = { status: 'idle', message: '' }

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('requestLinkEmail', () => {
  it('sends a receipt without ever returning it', async () => {
    domain.lookupLinkSession.mockResolvedValue({
      id: 's-1',
      state: 'awaiting_email',
      platform: 'slack',
      workspaceId: 'T0TEST',
      platformUserId: 'U0MEMBER',
      channelId: 'C0PROPOSALS',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      contactId: null,
    })
    domain.issueEmailChallenge.mockResolvedValue({
      ok: true,
      receiptToken: 'rle_secret_receipt',
      code: '123456',
      emailMasked: 'a***@example.test',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    const state = await requestLinkEmail(
      IDLE,
      form({ session_token: 'rls_session', email: 'member@example.test' }),
    )

    expect(state.status).toBe('success')
    expect(state.message).not.toContain('rle_secret_receipt')
    expect(JSON.stringify(state)).not.toContain('rle_secret_receipt')
    expect(JSON.stringify(state)).not.toContain('123456')
    expect(vi.mocked(sendTransactionalEmail)).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(sendTransactionalEmail).mock.calls[0][0] as { to: string; html: string }
    expect(sent.to).toBe('member@example.test')
    expect(sent.html).toContain('rle_secret_receipt')
  })

  it('answers a malformed address without a lookup or a send', async () => {
    vi.mocked(sendTransactionalEmail).mockClear()
    domain.lookupLinkSession.mockClear()
    const state = await requestLinkEmail(IDLE, form({ session_token: 'rls_session', email: 'not-an-address' }))
    expect(state.status).toBe('error')
    expect(state.fieldErrors?.email).toBeDefined()
    expect(domain.lookupLinkSession).not.toHaveBeenCalled()
    expect(vi.mocked(sendTransactionalEmail)).not.toHaveBeenCalled()
  })

  it('keeps the response generic when the session is no longer usable', async () => {
    domain.lookupLinkSession.mockResolvedValue(null)
    const state = await requestLinkEmail(
      IDLE,
      form({ session_token: 'rls_expired', email: 'member@example.test' }),
    )
    expect(state.status).toBe('error')
    expect(vi.mocked(sendTransactionalEmail)).not.toHaveBeenCalled()
  })
})

describe('confirmLinkEmail', () => {
  it('requires the posted address that the challenge was issued against', async () => {
    const state = await confirmLinkEmail(
      IDLE,
      form({ session_token: 'rls_session', receipt_token: 'rle_receipt' }),
    )
    expect(state.status).toBe('error')
    expect(state.fieldErrors?.email).toBeDefined()
    expect(domain.confirmLinkEmailDomain).not.toHaveBeenCalled()
  })

  it('returns the channel binding code to the browser after a confirmed address', async () => {
    domain.confirmLinkEmailDomain.mockResolvedValue({
      ok: true,
      emailMasked: 'm***@example.test',
      contactId: 'c-1',
      outcome: 'verified',
      bindingCode: 'rein-abc123def456',
      bindingExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    const state = await confirmLinkEmail(
      IDLE,
      form({
        session_token: 'rls_session',
        receipt_token: 'rle_receipt',
        email: 'member@example.test',
      }),
    )

    expect(state.status).toBe('code')
    expect(state.code).toBe('rein-abc123def456')
    expect(domain.confirmLinkEmailDomain).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: 'rls_session', receiptToken: 'rle_receipt', email: 'member@example.test' }),
    )
  })

  it('reports an expired receipt without leaking the reason code', async () => {
    domain.confirmLinkEmailDomain.mockResolvedValue({ ok: false, reason: 'binding_expired' })
    const state = await confirmLinkEmail(
      IDLE,
      form({ session_token: 'rls_session', receipt_token: 'rle_receipt', email: 'member@example.test' }),
    )
    expect(state.status).toBe('error')
    expect(state.message).not.toContain('binding_expired')
  })

  it('requires administrator registration for an address outside the community records', async () => {
    domain.confirmLinkEmailDomain.mockResolvedValue({ ok: false, reason: 'contact_not_registered' })
    const state = await confirmLinkEmail(
      IDLE,
      form({ session_token: 'rls_session', receipt_token: 'rle_receipt', email: 'new@example.test' }),
    )

    expect(state.status).toBe('error')
    expect(state.message).toContain('not registered')
    expect(state.message).toContain('administrator')
    expect(state.code).toBeUndefined()
  })
})
