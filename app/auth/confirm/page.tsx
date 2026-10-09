import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { EmailVerificationForm } from './verification-form'
import { emailOtpLength } from '@/lib/auth/verification-server'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false, follow: false } }

export default async function EmailConfirmationPage() {
  // This is only an account-switch warning, never an identity/authorization
  // check. Reading cookie presence avoids triggering an SDK session refresh.
  const hasSession = (await cookies()).getAll().some(({ name, value }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name) && Boolean(value))
  return <main className="admin-login"><section className="admin-login__panel">
    <p className="eyebrow">Rein Protocol Foundation · Account security</p>
    <h1>Continue with your email</h1>
    <p>Opening this page does not use your one-time link. Confirm below only if you requested this email.</p>
    {hasSession ? <p className="form-status" role="status">This browser has an existing sign-in. Continuing may switch it to the account associated with this email.</p> : null}
    <EmailVerificationForm otpLength={emailOtpLength()} />
    <noscript><p role="alert">JavaScript is required to confirm an email or enter a verification code. Enable it and reopen the original email link.</p></noscript>
  </section></main>
}
