import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Credential and one-time-value helpers for the machine boundary.
 *
 * Everything here is digest-first: callers store and compare hashes, and a raw
 * credential, session token, email receipt token, numeric code or channel
 * binding code exists only in the response that created it. Nothing in this
 * module reads a clock or touches a database, so it is safe to call from a
 * route handler and straightforward to test.
 */

const CREDENTIAL_BYTES = 32
const TOKEN_BYTES = 32

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** A fresh service credential. Returned once at registration and never stored. */
export function generateServiceCredential(): string {
  return `rs_${randomBytes(CREDENTIAL_BYTES).toString('base64url')}`
}

export const hashServiceCredential = hashValue

/** The value carried by a link session URL. */
export function generateSessionToken(): string {
  return `rls_${randomBytes(TOKEN_BYTES).toString('base64url')}`
}

/** The value carried by the emailed receipt link. */
export function generateEmailReceiptToken(): string {
  return `rle_${randomBytes(TOKEN_BYTES).toString('base64url')}`
}

/** The value returned to the relay. Short lived and never a model argument. */
export function generateIngressAssertion(): string {
  return `ria_${randomBytes(TOKEN_BYTES).toString('base64url')}`
}

/** A six-digit numeric code for the emailed receipt. */
export function generateNumericCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** The channel-binding code the person types back into their chat platform. */
export function generateBindingCode(): string {
  return `rein-${randomBytes(9).toString('base64url').toLowerCase()}`
}

/** Constant-time comparison of two hex digests of equal length. */
export function digestsMatch(left: string, right: string): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (left.length !== right.length || left.length === 0) return false
  try {
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  } catch {
    return false
  }
}

/** Show enough of an address for the person to recognise it, and no more. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`
}
