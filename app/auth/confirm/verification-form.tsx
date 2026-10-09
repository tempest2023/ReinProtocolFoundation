'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { parseVerificationFragment, verificationDestinations, type VerificationFlow } from '@/lib/auth/email-verification'

const messages: Record<string, string> = {
  invalid_request: 'Check your email address and enter the complete numeric code from your email.',
  invalid_or_expired: 'This link or code is invalid, expired, or already used. Request a new email from the sign-in page.',
  request_rejected: 'This confirmation request could not be accepted. Reload the page, then reopen the email link or enter its code.',
  not_authorized: 'Your email was verified, but this account is not authorized to access administration.',
  rate_limited: 'Too many attempts. Please wait before trying again.',
  temporarily_unavailable: 'We could not confirm the result. Check your session using the links below, or request a new email. Your code may already have been used.',
}

export function EmailVerificationForm({ otpLength }: { otpLength: number }) {
  const [credential, setCredential] = useState<ReturnType<typeof parseVerificationFragment>>(null)
  const [flow, setFlow] = useState<VerificationFlow>('admin-signin')
  const [csrf, setCsrf] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [terminal, setTerminal] = useState(false)
  const submitting = useRef(false)
  const initialized = useRef(false)

  useEffect(() => {
    function readLink() {
      const hash = window.location.hash
      const parsed = parseVerificationFragment(hash)
      const query = window.location.search
      window.history.replaceState(window.history.state, '', window.location.pathname)
      if (submitting.current) return
      setTerminal(false)
      if (parsed && !query) { setCredential(parsed); setFlow(parsed.flow); setMessage('') }
      else if (hash || query) {
        setCredential(null)
        setMessage('This link could not be read. Enter the code from your email, or reopen the original email link.')
      }
    }
    // Guard Strict Mode effect replay; the first effect already cleared the URL.
    if (!initialized.current) {
      initialized.current = true
      readLink()
    }
    window.addEventListener('hashchange', readLink)
    const controller = new AbortController()
    void fetch('/api/auth/verify', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok || typeof body.csrf !== 'string') throw new Error('nonce_unavailable')
        setCsrf(body.csrf)
      })
      .catch(() => { if (!controller.signal.aborted) setMessage('The confirmation page could not be prepared. Reload this page and reopen the email link, or enter its code.') })
    return () => { controller.abort(); window.removeEventListener('hashchange', readLink) }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !csrf || terminal) return
    submitting.current = true
    setBusy(true); setMessage('')
    const form = event.currentTarget
    const fields = new FormData(form)
    const input = credential
      ? { mode: 'link', flow: credential.flow, token_hash: credential.token_hash, csrf }
      : { mode: 'otp', flow, email: String(fields.get('email') ?? ''), token: String(fields.get('token') ?? '').trim(), csrf }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      })
      const body = await response.json()
      if (response.ok && body.status === 'verified' && body.destination === verificationDestinations[input.flow]) {
        setCredential(null); form.reset(); setTerminal(true)
        window.location.assign(body.destination)
        return
      }
      const status = typeof body.status === 'string' && messages[body.status] ? body.status : 'temporarily_unavailable'
      const retryAfter = Number(response.headers.get('retry-after'))
      setMessage(messages[status] + (status === 'rate_limited' && retryAfter > 0 ? ` Try again in ${Math.ceil(retryAfter)} seconds.` : ''))
      if (['not_authorized', 'invalid_or_expired', 'temporarily_unavailable'].includes(status)) {
        setCredential(null); form.reset(); setTerminal(true)
      }
      if (status === 'request_rejected') setCsrf('')
    } catch {
      setMessage(messages.temporarily_unavailable)
      setCredential(null); form.reset(); setTerminal(true)
    } finally {
      window.clearTimeout(timeout)
      submitting.current = false; setBusy(false)
    }
  }

  return <>
    <form className="admin-form" onSubmit={submit}>
      <p>Continuing will sign this browser in to the account associated with this email. It may replace an existing sign-in. Email verification does not grant administrator access.</p>
      {credential ? <p>Your one-time email link is ready. It will be used only when you click the confirmation button.</p> : <>
        <p>If you refreshed this page or the link is missing, reopen the original email or enter its verification code here.</p>
        <label>Action<select value={flow} onChange={(event) => setFlow(event.target.value as VerificationFlow)} disabled={busy || terminal}>
          <option value="admin-signin">Administrator sign-in</option><option value="confirm-email">Confirm email address</option>
        </select></label>
        <label>Email<input type="email" name="email" autoComplete="email" maxLength={320} required disabled={busy || terminal} /></label>
        <label>Verification code<input type="text" name="token" inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9]{${otpLength}}`} maxLength={otpLength} required disabled={busy || terminal} /></label>
      </>}
      {message ? <p className="form-status" data-kind="error" role="alert">{message}</p> : null}
      <button type="submit" className="primary-action submit-button" disabled={!csrf || busy || terminal}>{busy ? 'Confirming…' : flow === 'admin-signin' ? 'Confirm sign-in' : 'Confirm email address'}</button>
      {credential ? <button type="button" className="text-button" disabled={busy} onClick={() => { setCredential(null); setMessage('') }}>Use an email code instead</button> : null}
    </form>
    <p><a href="/admin/login">Request a new sign-in email or check administrator access</a></p>
    <p><a href="/auth/confirmed">Check your email confirmation session</a> · <a href="/">Return to the public site</a></p>
  </>
}
