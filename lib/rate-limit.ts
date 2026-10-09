import 'server-only'
import { isIP } from 'node:net'
import { requireSecretClient } from '@/lib/supabase/secret'
import { hashedRateIdentifier, normalizeEmail, requestIpAddress } from '@/lib/security'

export class RateLimitError extends Error {
  constructor(public readonly retryAfter: number) { super('rate_limit_exceeded') }
}

export type RateIdentifier = { type: 'ip' | 'email_hash'; value: string }

// Vercel supplies this header. Outside Vercel, use a shared bucket rather than
// trusting client-controlled forwarded headers. Other hosts need a trusted adapter.
export function authRequestIp(requestHeaders: Headers) {
  const candidate = process.env.VERCEL === '1' ? requestHeaders.get('x-vercel-forwarded-for')?.trim() : undefined
  return candidate && isIP(candidate) ? candidate : 'unknown'
}

export async function consumeFormRateLimit(scope: string, start: Date, limit: number, identifier?: RateIdentifier, retryAfter = 60) {
  const client = requireSecretClient()
  const key = identifier ?? { type: 'ip' as const, value: await requestIpAddress() }
  const expires = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  const { data, error } = await client.rpc('consume_form_rate_limit', {
    p_rate_key: key.value, p_identifier_type: key.type, p_form_type: scope,
    p_window_start: start.toISOString(), p_limit: limit, p_expires_at: expires.toISOString(),
  })
  if (error || typeof data !== 'boolean') throw new Error('rate_limit_unavailable')
  if (!data) throw new RateLimitError(retryAfter)
}

export async function consumeAuthRateLimits(action: 'verify' | 'send', requestHeaders: Headers, email?: string) {
  const seconds = action === 'verify' ? 600 : 3600
  const now = Date.now()
  const start = new Date(Math.floor(now / (seconds * 1000)) * seconds * 1000)
  const retryAfter = Math.max(1, Math.ceil((start.getTime() + seconds * 1000 - now) / 1000))
  await consumeFormRateLimit(`auth_${action}_ip`, start, action === 'verify' ? 30 : 10,
    { type: 'ip', value: authRequestIp(requestHeaders) }, retryAfter)
  if (email) {
    const scope = `auth_${action}_email`
    await consumeFormRateLimit(scope, start, action === 'verify' ? 5 : 3,
      { type: 'email_hash', value: hashedRateIdentifier(scope, normalizeEmail(email)) }, retryAfter)
  }
}
