import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyVerificationError, emailVerificationSchema, parseVerificationFragment, parseVerificationJson } from '@/lib/auth/email-verification'
import { createCsrfNonce, isFreshCsrfNonce, matchesCsrfNonce, readVerificationBody, verificationOrigin } from '@/lib/auth/verification-server'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('email verification inputs', () => {
  const base = { mode: 'link', flow: 'admin-signin', csrf: 'nonce', token_hash: 'hash-token' }
  it('accepts only supported, mutually exclusive modes and normalizes OTP email', () => {
    const schema = emailVerificationSchema(8)
    expect(schema.parse(base)).toEqual(base)
    expect(schema.parse({ mode: 'otp', flow: 'confirm-email', csrf: 'nonce', email: ' Person@Example.org ', token: '01234567' })).toMatchObject({ email: 'person@example.org', token: '01234567' })
    for (const input of [
      { ...base, email: 'admin@example.org' }, { ...base, token: '12345678' },
      { ...base, flow: 'recovery' }, { ...base, type: 'invite' }, { ...base, next: '//evil.test' },
      { ...base, redirect_to: '/admin' }, { ...base, url: 'https://evil.test' },
      { ...base, token_hash: 'a'.repeat(513) }, { ...base, token_hash: 'hash?query' },
    ]) expect(schema.safeParse(input).success).toBe(false)
    expect(schema.safeParse({ mode: 'otp', flow: 'admin-signin', csrf: 'nonce', email: 'admin@example.org', token: '123456' }).success).toBe(false)
  })

  it('rejects duplicate JSON keys, escaped duplicates, non-string values, nested objects and trailing commas', () => {
    expect(parseVerificationJson(JSON.stringify(base))).toEqual(base)
    for (const value of [
      '{"mode":"otp","mode":"link"}', '{"mode":"otp","\\u006dode":"link"}',
      '{"mode":null}', '{"mode":{"token":"secret"}}', '{"mode":"link",}',
      '["link"]', '{"mode":"link"} trailing', '{"mode":"line\nbreak"}',
    ]) expect(() => parseVerificationJson(value)).toThrow('invalid_request')
  })

  it('parses only exact fragment links and never recognizes an arbitrary redirect or API type', () => {
    expect(parseVerificationFragment('#token_hash=hash-token&flow=admin-signin')).toEqual({ token_hash: 'hash-token', flow: 'admin-signin' })
    for (const value of [
      '#token_hash=hash&flow=admin-signin&flow=confirm-email', '#token_hash=hash&flow=recovery',
      '#token_hash=hash&flow=admin-signin&next=/admin', '#token_hash=hash',
      '#ConfirmationURL=https://evil.test', '#token_hash=&flow=admin-signin',
    ]) expect(parseVerificationFragment(value)).toBeNull()
  })

  it('enforces a streamed byte limit even when Content-Length is absent or misleading', async () => {
    for (const headers of [new Headers(), new Headers({ 'Content-Length': '1' }), new Headers({ 'Content-Length': '4097' })]) {
      await expect(readVerificationBody(new Request('https://rein.test', { method: 'POST', body: 'é'.repeat(2049), headers }))).rejects.toThrow('invalid_request')
    }
    expect(await readVerificationBody(new Request('https://rein.test', { method: 'POST', body: '{}' }))).toBe('{}')
  })
})

describe('verification security and error handling', () => {
  it('expires CSRF nonces and compares only valid nonce strings', () => {
    vi.useFakeTimers()
    const nonce = createCsrfNonce()
    expect(isFreshCsrfNonce(nonce)).toBe(true)
    expect(matchesCsrfNonce(nonce, nonce)).toBe(true)
    expect(matchesCsrfNonce(nonce, createCsrfNonce())).toBe(false)
    expect(matchesCsrfNonce(nonce, '密'.repeat(nonce.length))).toBe(false)
    vi.advanceTimersByTime(600000)
    expect(isFreshCsrfNonce(nonce)).toBe(false)
  })

  it('uses configured origin rather than forwarded host, requiring HTTPS in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    // The default local origin is deliberately invalid in production.
    expect(() => verificationOrigin()).toThrow('invalid_auth_origin')
  })

  it('classifies only known token failures as expired and keeps upstream failures uncertain', () => {
    expect(classifyVerificationError({ status: 403, code: 'otp_expired' })).toBe('invalid_or_expired')
    expect(classifyVerificationError({ status: 429 })).toBe('rate_limited')
    expect(classifyVerificationError({ status: 503, code: 'unexpected_failure' })).toBe('temporarily_unavailable')
    expect(classifyVerificationError({ status: 400, code: 'unknown' })).toBe('temporarily_unavailable')
  })
})
