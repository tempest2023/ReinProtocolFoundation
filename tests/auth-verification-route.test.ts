// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCsrfNonce, csrfCookieName } from '@/lib/auth/verification-server'

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), consume: vi.fn(), allowed: vi.fn(), routeClient: vi.fn(), exchange: vi.fn() }))
vi.mock('@/lib/rate-limit', async (original) => ({ ...await original<typeof import('@/lib/rate-limit')>(), consumeAuthRateLimits: mocks.consume }))
vi.mock('@/lib/admin/auth', () => ({ isAllowedAdminUser: mocks.allowed }))
vi.mock('@/lib/supabase/route', () => ({ createSupabaseRouteClient: mocks.routeClient }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }) }))
import { GET, HEAD, POST } from '@/app/api/auth/verify/route'
import { GET as callback } from '@/app/auth/callback/route'
import { RateLimitError } from '@/lib/rate-limit'

function verificationRequest(overrides: Record<string, unknown> = {}, options: { origin?: string | null; csrfCookie?: string; body?: string; contentType?: string; query?: string } = {}) {
  const nonce = createCsrfNonce()
  return new NextRequest(`http://localhost:3000/api/auth/verify${options.query ?? ''}`, {
    method: 'POST',
    headers: {
      ...(options.origin !== null ? { Origin: options.origin ?? 'http://localhost:3000' } : {}),
      'Content-Type': options.contentType ?? 'application/json',
      Cookie: `${csrfCookieName()}=${options.csrfCookie ?? nonce}`,
    },
    body: options.body ?? JSON.stringify({ mode: 'link', flow: 'admin-signin', token_hash: 'test-token', csrf: nonce, ...overrides }),
  })
}

describe('email verification Route Handler', () => {
  const user = { id: 'user-1', email: 'verified@example.org', email_confirmed_at: '2026-10-08T00:00:00Z' }
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consume.mockResolvedValue(undefined)
    mocks.allowed.mockResolvedValue(true)
    mocks.exchange.mockResolvedValue({ error: null })
    mocks.verifyOtp.mockResolvedValue({ data: { user, session: { user } }, error: null })
    mocks.routeClient.mockReturnValue({ client: { auth: { verifyOtp: mocks.verifyOtp } }, applyCookies: (response: NextResponse) => {
      response.cookies.set('sb-test-auth-token.0', 'chunk-0', { path: '/' })
      response.cookies.set('sb-test-auth-token.1', 'chunk-1', { path: '/' })
      response.cookies.set('sb-test-auth-token.2', '', { path: '/', maxAge: 0 })
      return response
    } })
  })

  it('GET and HEAD never consume a credential or send email; fresh nonces are reused across tabs', async () => {
    const get = await GET(new NextRequest('http://localhost:3000/api/auth/verify'))
    const { csrf } = await get.json()
    expect(get.cookies.get(csrfCookieName())?.value).toBe(csrf)
    expect(get.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(get.headers.get('cache-control')).toContain('no-store')
    const second = await GET(new NextRequest('http://localhost:3000/api/auth/verify', { headers: { Cookie: `${csrfCookieName()}=${csrf}` } }))
    expect(await second.json()).toEqual({ csrf })
    expect(second.headers.get('set-cookie')).toBeNull()
    expect(HEAD().headers.get('set-cookie')).toBeNull()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.consume).not.toHaveBeenCalled()
  })

  it.each([
    [{}, { origin: null }, 403], [{}, { origin: 'https://evil.test' }, 403],
    [{ csrf: 'wrong' }, {}, 403], [{}, { csrfCookie: 'missing' }, 403],
    [{ flow: 'recovery' }, {}, 400], [{ next: '/admin' }, {}, 400], [{ redirect_to: 'https://evil.test' }, {}, 400],
    [{ type: 'magiclink' }, {}, 400], [{ token_hash: 'x'.repeat(513) }, {}, 400],
    [{}, { body: '{"mode":"link","mode":"otp"}' }, 400],
    [{}, { body: '{"value":"' + 'x'.repeat(4096) + '"}' }, 400],
    [{}, { contentType: 'text/plain' }, 400], [{}, { query: '?token_hash=secret' }, 400],
  ] as const)('rejects invalid input or provenance before calling Supabase (%j / %j)', async (input, options, status) => {
    const result = await POST(verificationRequest(input, options))
    expect(result.status).toBe(status)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.consume).not.toHaveBeenCalled()
  })

  it('establishes a session, copies all cookie chunks, checks the verified identity and returns only a fixed destination', async () => {
    const result = await POST(verificationRequest())
    expect(await result.json()).toEqual({ status: 'verified', destination: '/admin' })
    expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: 'test-token', type: 'email' })
    expect(mocks.allowed).toHaveBeenCalledWith(user)
    expect(result.cookies.getAll().map((cookie) => cookie.name)).toEqual(['sb-test-auth-token.0', 'sb-test-auth-token.1', 'sb-test-auth-token.2'])
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('verifies an email and numeric OTP as separate parameters without granting admin permission', async () => {
    const result = await POST(verificationRequest({ mode: 'otp', token_hash: undefined, email: ' Person@Example.org ', token: '01234567', flow: 'confirm-email' }))
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: 'person@example.org', token: '01234567', type: 'email' })
    expect(mocks.consume).toHaveBeenCalledWith('verify', expect.any(Headers), 'person@example.org')
    expect(mocks.allowed).not.toHaveBeenCalled()
    expect(await result.json()).toEqual({ status: 'verified', destination: '/auth/confirmed' })
  })

  it('reports authorization failure separately and keeps the established session', async () => {
    mocks.allowed.mockResolvedValue(false)
    const result = await POST(verificationRequest())
    expect(result.status).toBe(403)
    expect(await result.json()).toEqual({ status: 'not_authorized' })
    expect(result.cookies.getAll()).toHaveLength(3)
  })

  it.each([null, { user: { id: 'another-user' } }])('does not report success for a missing or mismatched session', async (session) => {
    mocks.verifyOtp.mockResolvedValue({ data: { user, session }, error: null })
    const result = await POST(verificationRequest())
    expect(result.status).toBe(503)
    expect(result.headers.get('set-cookie')).toBeNull()
  })

  it('keeps a session available when authorization lookup fails after consuming the token', async () => {
    mocks.allowed.mockRejectedValue(new Error('private failure'))
    const result = await POST(verificationRequest())
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ status: 'temporarily_unavailable' })
    expect(result.cookies.getAll()).toHaveLength(3)
  })

  it.each([
    [{ status: 403, code: 'otp_expired', message: 'private token detail' }, 400, 'invalid_or_expired'],
    [{ status: 429, code: 'over_request_rate_limit' }, 429, 'rate_limited'],
    [{ status: 500, code: 'unexpected_failure' }, 503, 'temporarily_unavailable'],
  ])('classifies upstream failures without leaking raw error details', async (error, code, status) => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error })
    const result = await POST(verificationRequest())
    expect(result.status).toBe(code)
    expect(await result.json()).toEqual({ status })
    expect(result.headers.get('set-cookie')).toBeNull()
    if (code === 429) expect(result.headers.get('retry-after')).toBe('60')
  })

  it.each([new RateLimitError(42), new Error('limiter database offline')])('fails closed on limiter refusal or outage', async (error) => {
    mocks.consume.mockRejectedValue(error)
    const result = await POST(verificationRequest())
    expect(result.status).toBe(error instanceof RateLimitError ? 429 : 503)
    if (error instanceof RateLimitError) expect(result.headers.get('retry-after')).toBe('42')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('preserves old PKCE callbacks and rejects an external redirect', async () => {
    const result = await callback(new Request('http://localhost:3000/auth/callback?code=old-pkce-code&next=//evil.test'))
    expect(mocks.exchange).toHaveBeenCalledWith('old-pkce-code')
    expect(result.headers.get('location')).toBe('http://localhost:3000/admin')
  })
})
