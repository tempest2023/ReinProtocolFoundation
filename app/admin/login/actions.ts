'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { isDirectAdminLoginEnabled, publicEnv } from '@/lib/env'
import { isAllowedAdminEmail } from '@/lib/admin/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSecretClient } from '@/lib/supabase/secret'
import type { AdminSignInState } from '@/lib/auth/sign-in'
import { consumeAuthRateLimits, RateLimitError } from '@/lib/rate-limit'
import { isPlausibleEmail, normalizeEmail } from '@/lib/security'

export async function requestAdminLink(_previous: AdminSignInState, formData: FormData): Promise<AdminSignInState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  if (formData.getAll('email').length !== 1 || !isPlausibleEmail(email)) return { status: 'error', message: 'Enter a valid administrator email.' }
  const method = formData.get('method') ?? 'magic-link'
  if (formData.getAll('method').length > 1 || (method !== 'magic-link' && method !== 'code')) return { status: 'error', message: 'Choose a sign-in method.' }
  const sent = (): AdminSignInState => ({ status: 'success', email, method, retryAt: Date.now() + 60000, message: method === 'code' ? 'If this address is authorized, a verification code has been sent.' : 'If this address is authorized, a sign-in link has been sent.' })
  const client = await createSupabaseServerClient()
  if (!client) return { status: 'error', message: 'Supabase authentication is not configured.' }

  const directLogin = isDirectAdminLoginEnabled()
  if (!directLogin) {
    try { await consumeAuthRateLimits('send', await headers(), email) }
    catch (error) {
      return { status: 'error', message: error instanceof RateLimitError ? 'Too many sign-in requests. Please try again later.' : 'Sign-in is temporarily unavailable. Please try again later.' }
    }
  }
  let authorized: boolean
  try { authorized = await isAllowedAdminEmail(email) }
  catch { return { status: 'error', message: 'Sign-in is temporarily unavailable. Please try again later.' } }
  if (!authorized) {
    return directLogin ? { status: 'success', message: 'If this address is authorized, you will be signed in.' } : sent()
  }

  if (directLogin) {
    const service = requireSecretClient()
    const { data, error: linkError } = await service.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/admin` },
    })
    if (linkError || !data.properties.hashed_token) {
      return { status: 'error', message: 'The development sign-in session could not be created.' }
    }

    const { error: verificationError } = await client.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: 'email',
    })
    if (verificationError) {
      return { status: 'error', message: 'The development sign-in session could not be verified.' }
    }

    redirect('/admin')
  }

  try {
    await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${publicEnv.siteUrl}${method === 'code' ? '/auth/code' : '/auth/confirm'}` },
    })
  } catch { /* Delivery failures must not reveal whether this address is authorized. */ }
  return sent()
}
