import { NextResponse, type NextRequest } from 'next/server'
import { classifyVerificationError, emailVerificationSchema, parseVerificationJson, verificationDestinations } from '@/lib/auth/email-verification'
import { createCsrfNonce, csrfCookieName, csrfMaxAge, emailOtpLength, isFreshCsrfNonce, matchesCsrfNonce, readVerificationBody, verificationOrigin } from '@/lib/auth/verification-server'
import { createSupabaseRouteClient } from '@/lib/supabase/route'
import { isAllowedAdminUser } from '@/lib/admin/auth'
import { consumeAuthRateLimits, RateLimitError } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function response(body: Record<string, string>, status = 200, retryAfter?: number) {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY',
    ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
  } })
}

export async function GET(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    if ((origin && origin !== verificationOrigin()) || request.headers.get('sec-fetch-site') === 'cross-site') return response({ status: 'request_rejected' }, 403)
    if (request.nextUrl.search) return response({ status: 'invalid_request' }, 400)
    const name = csrfCookieName()
    const existing = request.cookies.get(name)?.value
    const csrf = isFreshCsrfNonce(existing) ? existing : createCsrfNonce()
    const result = response({ csrf })
    if (csrf !== existing) result.cookies.set(name, csrf, {
      httpOnly: true, secure: verificationOrigin().startsWith('https:'), sameSite: 'lax', path: '/', maxAge: csrfMaxAge,
    })
    return result
  } catch { return response({ status: 'temporarily_unavailable' }, 503) }
}

export function HEAD() {
  return new NextResponse(null, { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } })
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== verificationOrigin()) return response({ status: 'request_rejected' }, 403)
    if (request.nextUrl.search || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) return response({ status: 'invalid_request' }, 400)
    let input
    const schema = emailVerificationSchema(emailOtpLength())
    try { input = schema.parse(parseVerificationJson(await readVerificationBody(request))) }
    catch { return response({ status: 'invalid_request' }, 400) }
    if (!matchesCsrfNonce(request.cookies.get(csrfCookieName())?.value, input.csrf)) return response({ status: 'request_rejected' }, 403)
    await consumeAuthRateLimits('verify', request.headers, input.mode === 'otp' ? input.email : undefined)
    const { client, applyCookies } = createSupabaseRouteClient(request)
    const params = input.mode === 'link'
      ? { token_hash: input.token_hash, type: 'email' as const }
      : { email: input.email, token: input.token, type: 'email' as const }
    const { data, error } = await client.auth.verifyOtp(params)
    if (error) {
      const status = classifyVerificationError(error)
      return response({ status }, status === 'rate_limited' ? 429 : status === 'invalid_or_expired' ? 400 : 503, status === 'rate_limited' ? 60 : undefined)
    }
    if (!data.session || !data.user?.email || data.session.user.id !== data.user.id || !data.user.email_confirmed_at) return response({ status: 'temporarily_unavailable' }, 503)
    // A consumed credential has established a session even when authorization
    // fails. Persist it and report that distinct result instead of "expired".
    try {
      if (input.flow === 'admin-signin' && !await isAllowedAdminUser(data.user)) return applyCookies(response({ status: 'not_authorized' }, 403))
    } catch { return applyCookies(response({ status: 'temporarily_unavailable' }, 503)) }
    return applyCookies(response({ status: 'verified', destination: verificationDestinations[input.flow] }))
  } catch (error) {
    if (error instanceof RateLimitError) return response({ status: 'rate_limited' }, 429, error.retryAfter)
    return response({ status: 'temporarily_unavailable' }, 503)
  }
}
