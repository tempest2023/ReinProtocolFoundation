'use client'

import { useActionState, useEffect, useState } from 'react'
import { useAdminI18n } from '@/components/admin-i18n'
import { requestAdminLink } from '@/app/admin/login/actions'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { CodeSignInForm } from '@/components/auth/code-sign-in-form'
import type { AdminSignInState, SignInMethod } from '@/lib/auth/sign-in'

export function AdminLoginForm({ directLogin = false }: { directLogin?: boolean }) {
  const [attempt, setAttempt] = useState(0)
  return <RequestForm key={attempt} directLogin={directLogin} changeEmail={() => setAttempt((value) => value + 1)} />
}

function RequestForm({ directLogin, changeEmail }: { directLogin: boolean; changeEmail: () => void }) {
  const { t } = useAdminI18n()
  const [method, setMethod] = useState<SignInMethod>('magic-link')
  const [state, action, pending] = useActionState(async (previous: AdminSignInState, fields: FormData) => {
    const next = await requestAdminLink(previous, fields)
    return next.status === 'error' && previous.email ? { ...previous, sendError: next.message } : next
  }, { status: 'idle' } as AdminSignInState)
  const [now, setNow] = useState(Date.now)
  const remaining = Math.max(0, Math.ceil(((state.retryAt ?? 0) - now) / 1000))
  useEffect(() => {
    if (!state.retryAt) return
    const tick = () => setNow(Date.now())
    tick(); const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [state.retryAt])
  if (state.status === 'success' && state.email && state.method) return <div className="auth-sent">
    <div role="status" aria-live="polite">
      <h2>{t(state.method === 'code' ? 'Enter your verification code' : 'Check your email')}</h2>
      <p>{t(state.message ?? '')}</p>
      {state.method === 'magic-link' ? <><p className="auth-email-address">{state.email}</p><p>{t('Open the email and click “Sign in to Rein” to go directly to your dashboard.')}</p></> : <p>{t('Enter the 8-digit code from your email below.')}</p>}
      <p className="auth-help">{t('Valid for 2 hours. Use the most recent email; each link or code works once.')}</p>
    </div>
    {state.sendError ? <p className="form-status" data-kind="error" role="alert">{t(state.sendError)}</p> : null}
    {state.method === 'code' ? <CodeSignInForm email={state.email} /> : null}
    <div className="auth-secondary-actions">
      <form action={action}><input type="hidden" name="email" value={state.email} /><input type="hidden" name="method" value={state.method} /><button type="submit" className="auth-text-button" disabled={pending || remaining > 0}>{remaining > 0 ? t('Resend in {seconds}s', { seconds: remaining }) : t(pending ? 'Sending…' : 'Resend email')}</button></form>
      <button type="button" className="auth-text-button" disabled={pending} onClick={changeEmail}>{t('Change email or sign-in method')}</button>
    </div>
  </div>
  return <form className="admin-form" action={action}>
    {!directLogin ? <div className="auth-methods" role="group" aria-label={t('Sign-in method')}>
      <button type="button" aria-pressed={method === 'magic-link'} disabled={pending} onClick={() => setMethod('magic-link')}>{t('Email link')}</button>
      <button type="button" aria-pressed={method === 'code'} disabled={pending} onClick={() => setMethod('code')}>{t('Verification code')}</button>
    </div> : null}
    <input type="hidden" name="method" value={method} />
    {state.status !== 'idle' && state.message ? <p className="form-status" data-kind={state.status} role={state.status === 'error' ? 'alert' : 'status'}>{t(state.message)}</p> : null}
    <label>{t('Email')}<input type="email" name="email" autoComplete="email" maxLength={320} required disabled={pending} /></label>
    <AdminSubmitButton className="primary-action submit-button" pendingLabel={t(directLogin ? 'Signing in…' : 'Sending…')}>{t(directLogin ? 'Sign in' : method === 'code' ? 'Send verification code' : 'Send magic link')}</AdminSubmitButton>
    {!directLogin ? <a className="auth-help" href="/auth/code">{t('Already have a verification code?')}</a> : null}
  </form>
}
