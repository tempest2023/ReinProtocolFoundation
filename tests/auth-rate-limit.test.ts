// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/secret', () => ({ requireSecretClient: () => ({ rpc }) }))
import { authRequestIp, consumeAuthRateLimits, RateLimitError } from '@/lib/rate-limit'

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: true, error: null }) })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('shared Auth rate limits', () => {
  it('trusts only the Vercel-supplied IP on Vercel and ignores arbitrary forwarded headers elsewhere', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', 'x-vercel-forwarded-for': '203.0.113.4' })
    vi.stubEnv('VERCEL', '')
    expect(authRequestIp(headers)).toBe('unknown')
    vi.stubEnv('VERCEL', '1')
    expect(authRequestIp(headers)).toBe('203.0.113.4')
    headers.set('x-vercel-forwarded-for', '203.0.113.4, 198.51.100.1')
    expect(authRequestIp(headers)).toBe('unknown')
  })

  it('uses atomic independent scopes and hashes normalized emails without storing plaintext', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:04:00Z'))
    await consumeAuthRateLimits('verify', new Headers(), ' Person@Example.org ')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['consume_form_rate_limit', expect.objectContaining({ p_form_type: 'auth_verify_ip', p_limit: 30, p_window_start: '2026-10-08T12:00:00.000Z', p_identifier_type: 'ip' })])
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_form_type: 'auth_verify_email', p_limit: 5, p_identifier_type: 'email_hash', p_rate_key: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const verifyHash = rpc.mock.calls[1][1].p_rate_key
    await consumeAuthRateLimits('send', new Headers(), 'person@example.org')
    expect(rpc.mock.calls[2][1].p_limit).toBe(10)
    expect(rpc.mock.calls[3][1]).toMatchObject({ p_form_type: 'auth_send_email', p_limit: 3 })
    expect(rpc.mock.calls[3][1].p_rate_key).not.toBe(verifyHash)
  })

  it('counts link attempts only by IP and exposes bounded retry time', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:04:00Z'))
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(consumeAuthRateLimits('verify', new Headers())).rejects.toMatchObject({ retryAfter: 360 })
    expect(rpc).toHaveBeenCalledOnce()
    expect(new RateLimitError(360).message).toBe('rate_limit_exceeded')
  })

  it('treats RPC failure or unexpected results as unavailable, not permission to continue', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(consumeAuthRateLimits('send', new Headers())).rejects.toThrow('rate_limit_unavailable')
    rpc.mockResolvedValue({ data: false, error: { message: 'database error' } })
    await expect(consumeAuthRateLimits('send', new Headers())).rejects.toThrow('rate_limit_unavailable')
  })
})
