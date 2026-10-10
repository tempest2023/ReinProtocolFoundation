import { verificationDestinations, type VerificationRequest } from '@/lib/auth/email-verification'

export const verificationMessages: Record<string, string> = {
  invalid_request: 'Check your email address and enter the complete 8-digit code.',
  invalid_or_expired: 'This link or code is invalid, expired, or already used. Request a new sign-in email.',
  request_rejected: 'Please reload this page and try again.',
  not_authorized: 'Your email was verified, but this account does not have administrator access.',
  rate_limited: 'Too many attempts. Please try again later.',
  temporarily_unavailable: 'We could not confirm the result. Your link or code may already have been used.',
}

export async function verifyEmail(input: Omit<Extract<VerificationRequest, { mode: 'link' }>, 'csrf'> | Omit<Extract<VerificationRequest, { mode: 'otp' }>, 'csrf'>) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20000)
  try {
    // Refresh the nonce at submission time: a user may keep the code form open
    // longer than the CSRF cookie's ten-minute lifetime.
    const options = { credentials: 'same-origin' as const, cache: 'no-store' as const, signal: controller.signal }
    const nonceResponse = await fetch('/api/auth/verify', options)
    const nonce = await nonceResponse.json()
    if (!nonceResponse.ok || typeof nonce.csrf !== 'string') return { status: 'request_rejected' }
    const response = await fetch('/api/auth/verify', {
      ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, csrf: nonce.csrf }),
    })
    const result = await response.json()
    if (response.ok && result.status === 'verified' && result.destination === verificationDestinations[input.flow]) return { status: 'verified', destination: result.destination as string }
    return { status: typeof result.status === 'string' && Object.hasOwn(verificationMessages, result.status) ? result.status : 'temporarily_unavailable', retryAfter: Math.max(0, Number(response.headers.get('retry-after')) || 0) }
  } catch {
    return { status: 'temporarily_unavailable' }
  } finally { window.clearTimeout(timeout) }
}
