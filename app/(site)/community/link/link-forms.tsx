'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { confirmLinkEmail, requestLinkEmail, type LinkFormState } from '@/lib/identity/link-actions'
import { SubmitButton } from '@/components/forms/form-controls'

const initialLinkState: LinkFormState = { status: 'idle', message: '' }

function LinkStatus({ state }: { state: LinkFormState }) {
  if (state.status !== 'error' && state.status !== 'success') return null
  return <div className="form-status" data-kind={state.status === 'error' ? 'error' : 'status'} role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite">
    <strong>{state.status === 'error' ? 'Please check the form' : 'Received'}</strong>
    {state.message ? <p>{state.message}</p> : null}
  </div>
}

export function LinkRequestForm({ session }: { session: string }) {
  const [state, action] = useActionState(requestLinkEmail, initialLinkState)
  return <form className="community-form" action={action} noValidate>
    <LinkStatus state={state} />
    <fieldset className="form-content">
      <legend className="visually-hidden">Account linking fields</legend>
      <input type="hidden" name="session_token" value={session} />
      <div className="field-grid">
        <label className="field-group field-group--full"><span className="field-label">Email address <span aria-hidden="true">*</span></span><input type="email" name="email" autoComplete="email" maxLength={320} required /><span className="field-hint">Use the address already registered with Rein Protocol.</span>{state.fieldErrors?.email ? <span className="field-error">{state.fieldErrors.email}</span> : null}</label>
      </div>
      <div className="form-actions"><SubmitButton>Send confirmation email</SubmitButton><Link href="/community" className="quiet-action">Return to Community</Link></div>
    </fieldset>
  </form>
}

export function LinkConfirmForm({ session, receipt }: { session: string; receipt: string }) {
  const [state, action] = useActionState(confirmLinkEmail, initialLinkState)
  const code = state.status === 'code' ? state.code : undefined
  return <form className="community-form" action={action} noValidate>
    <LinkStatus state={state} />
    {code ? <div className="form-notice" role="status" aria-live="polite"><strong>Your one-time binding code</strong><code style={{ userSelect: 'all' }}>{code}</code><p>Give this code to the Rein Agent in your chat platform to finish linking your email address. The code is short lived, so use it soon.</p></div> : null}
    <fieldset className="form-content">
      <legend className="visually-hidden">Account link confirmation fields</legend>
      <input type="hidden" name="session_token" value={session} />
      <input type="hidden" name="receipt_token" value={receipt} />
      <div className="field-grid">
        <label className="field-group field-group--full"><span className="field-label">Email address <span aria-hidden="true">*</span></span><input type="email" name="email" autoComplete="email" maxLength={320} required /><span className="field-hint">Type the same address the confirmation message was sent to.</span>{state.fieldErrors?.email ? <span className="field-error">{state.fieldErrors.email}</span> : null}</label>
      </div>
      <p>Confirm this to verify that you can receive mail at this address.</p>
      <div className="form-actions"><SubmitButton>Confirm this email address</SubmitButton><Link href="/community" className="quiet-action">Return to Community</Link></div>
    </fieldset>
  </form>
}
