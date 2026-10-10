'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useAdminI18n } from '@/components/admin-i18n'
import { verificationMessages, verifyEmail } from '@/lib/auth/verify-email-client'

export function CodeSignInForm({ email, otpLength = 8 }: { email?: string; otpLength?: number }) {
  const { t } = useAdminI18n()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [retryAfter, setRetryAfter] = useState(0)
  const submitting = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true; setBusy(true); setStatus(''); setRetryAfter(0)
    const fields = new FormData(event.currentTarget)
    const result = await verifyEmail({ mode: 'otp', flow: 'admin-signin', email: email ?? String(fields.get('email') ?? ''), token: String(fields.get('token') ?? '').trim() })
    if (result.status === 'verified' && result.destination) { window.location.replace(result.destination); return }
    setStatus(result.status); setRetryAfter(result.retryAfter ?? 0); setBusy(false); submitting.current = false
  }
  return <form className="admin-form auth-code-form" onSubmit={submit} aria-busy={busy}>
    {email ? <p className="auth-email-address">{email}</p> : <label>{t('Email')}<input type="email" name="email" autoComplete="email" maxLength={320} required disabled={busy} /></label>}
    <label>{t('Verification code')}<input type="text" name="token" inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9]{${otpLength}}`} maxLength={otpLength} required disabled={busy} autoFocus={Boolean(email)} /></label>
    {status ? <p className="form-status" data-kind="error" role="alert">{t(verificationMessages[status])}{retryAfter > 0 ? ` ${t('Try again in {seconds} seconds.', { seconds: Math.ceil(retryAfter) })}` : ''}</p> : null}
    <button type="submit" className="primary-action submit-button" disabled={busy}>{t(busy ? 'Signing in…' : 'Sign in')}</button>
    {status === 'temporarily_unavailable' ? <a href="/admin">{t('Check your sign-in status')}</a> : null}
  </form>
}
