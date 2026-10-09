import 'server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { publicEnv } from '@/lib/env'

export const csrfMaxAge = 600
export function verificationOrigin() {
  const url = new URL(publicEnv.siteUrl)
  const localHttp = process.env.VERCEL !== '1' && (process.env.NODE_ENV !== 'production' || process.env.AUTH_ALLOW_LOCAL_HTTP === '1')
    && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) throw new Error('invalid_auth_origin')
  return url.origin
}

export function csrfCookieName() {
  return verificationOrigin().startsWith('https:') ? '__Host-rein-auth-csrf' : 'rein-auth-csrf'
}

export function createCsrfNonce() { return `${Date.now()}.${randomBytes(32).toString('hex')}` }
export function isFreshCsrfNonce(value: string | undefined): value is string {
  if (!value || !/^\d{13}\.[a-f0-9]{64}$/.test(value)) return false
  const age = Date.now() - Number(value.split('.')[0])
  return age >= 0 && age < csrfMaxAge * 1000
}

export function matchesCsrfNonce(cookie: string | undefined, submitted: string) {
  return isFreshCsrfNonce(cookie) && isFreshCsrfNonce(submitted) && cookie.length === submitted.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(submitted))
}

// Local Auth configuration uses eight digits. Hosted deployments must set this
// to their read-back mailer_otp_length before switching the email templates.
export function emailOtpLength() {
  const length = Number(process.env.AUTH_EMAIL_OTP_LENGTH ?? 8)
  if (!Number.isInteger(length) || length < 6 || length > 10) throw new Error('invalid_otp_configuration')
  return length
}

export async function readVerificationBody(request: Request) {
  const maximum = 4096
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new Error('invalid_request')
  if (!request.body) throw new Error('invalid_request')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) { await reader.cancel(); throw new Error('invalid_request') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
