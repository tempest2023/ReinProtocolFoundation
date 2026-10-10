'use client'

import { useEffect, useRef, useState } from 'react'
import { useAdminI18n } from '@/components/admin-i18n'
import { parseVerificationFragment } from '@/lib/auth/email-verification'
import { verificationMessages, verifyEmail } from '@/lib/auth/verify-email-client'

export function EmailVerificationForm() {
  const { t } = useAdminI18n()
  const [status, setStatus] = useState('verifying')
  const [retryAfter, setRetryAfter] = useState(0)
  const started = useRef(false)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  useEffect(() => {
    mounted.current = true
    async function openLink() {
      const credential = window.location.search ? null : parseVerificationFragment(window.location.hash)
      window.history.replaceState(window.history.state, '', window.location.pathname)
      if (inFlight.current) return
      if (!credential) { setStatus('missing_link'); return }
      inFlight.current = true; setStatus('verifying'); setRetryAfter(0)
      const result = await verifyEmail({ mode: 'link', ...credential })
      inFlight.current = false
      if (!mounted.current) return
      if (result.status === 'verified' && result.destination) { window.location.replace(result.destination); return }
      setStatus(result.status); setRetryAfter(result.retryAfter ?? 0)
    }
    if (!started.current) { started.current = true; void openLink() }
    // Reopening a mail link on this same page is a fragment navigation, not a
    // remount. Process that explicit navigation as a new attempt.
    const onHashChange = () => { void openLink() }
    window.addEventListener('hashchange', onHashChange)
    // Do not abort/restart the one-time exchange on Strict Mode effect replay.
    return () => { mounted.current = false; window.removeEventListener('hashchange', onHashChange) }
  }, [])

  const busy = status === 'verifying'
  return <div className="auth-link-result" aria-busy={busy}>
    <h1>{t(busy ? 'Signing you in…' : 'Unable to continue')}</h1>
    {busy ? <p role="status">{t('Please wait. You will be taken to Rein automatically.')}</p> : <>
      <p className="form-status" data-kind="error" role="alert">{t(status === 'missing_link' ? 'The sign-in link is missing or incomplete. Reopen the full link from your email.' : verificationMessages[status])}{retryAfter > 0 ? ` ${t('Try again in {seconds} seconds.', { seconds: Math.ceil(retryAfter) })}` : ''}</p>
      <a className="primary-action auth-primary-link" href="/admin/login">{t('Request a new sign-in email')}</a>
      {status === 'temporarily_unavailable' ? <p><a href="/admin">{t('Check your sign-in status')}</a></p> : null}
    </>}
    <p className="auth-footer"><a href="/">{t('Return to the public site')}</a></p>
  </div>
}
