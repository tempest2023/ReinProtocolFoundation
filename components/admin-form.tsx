'use client'

import { useActionState, useEffect, useRef } from 'react'
import { runAdminFormAction, type AdminFormActionId, type AdminFormActionState } from '@/app/admin/actions'

const initialState: AdminFormActionState = { status: 'idle', message: '' }

export function AdminForm({
  actionId,
  children,
  className = 'admin-form',
  resetKey,
  successMessage = 'Changes saved.',
}: {
  actionId: AdminFormActionId
  children: React.ReactNode
  className?: string
  resetKey?: string
  successMessage?: string
}) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const [state, formAction] = useActionState(runAdminFormAction, initialState)
  const message = state.status === 'success' ? successMessage : state.message

  useEffect(() => {
    if (state.status !== 'idle') statusRef.current?.focus()
  }, [state])

  return (
    <form key={resetKey} className={className} action={formAction}>
      <input type="hidden" name="_admin_action" value={actionId} />
      {children}
      {message ? <p ref={statusRef} className={`admin-action-feedback admin-action-feedback--${state.status}`} role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite" tabIndex={-1}>{message}</p> : null}
    </form>
  )
}
