import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Email confirmation', robots: { index: false, follow: false } }

export default async function ConfirmedEmailPage() {
  let confirmed = false
  let unavailable = false
  try {
    const client = await createSupabaseServerClient()
    if (!client) unavailable = true
    else {
      const { data, error } = await client.auth.getUser()
      unavailable = Boolean(error && error.name !== 'AuthSessionMissingError')
      confirmed = Boolean(!error && data.user?.email_confirmed_at)
    }
  } catch { unavailable = true }
  return <main className="admin-login"><section className="admin-login__panel">
    <p className="eyebrow">Rein Protocol Foundation · Account security</p>
    <h1>{confirmed ? 'Your email is confirmed' : unavailable ? 'We could not check your session' : 'Confirm your email to continue'}</h1>
    <p>{confirmed ? 'This browser has a verified email session. Administrator access is checked separately.' : 'Reopen your original email link or enter its verification code. This page can confirm a result only when a verified session is available.'}</p>
    <p><a href="/admin/login">Continue to administrator sign-in</a></p>
    {!confirmed ? <p><a href="/auth/confirm">Enter an email verification code</a></p> : null}
    <p><a href="/">Return to the public site</a></p>
  </section></main>
}
