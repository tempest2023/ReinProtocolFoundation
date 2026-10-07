'use client'

import { useAdminI18n } from '@/components/admin-i18n'
import { useActionState } from 'react'
import { requestAdminLink } from '@/app/admin/login/actions'
import { initialActionState } from '@/lib/community/types'
import { FormStatus } from '@/components/forms/form-controls'
import { AdminSubmitButton } from '@/components/admin-submit-button'

export function AdminLoginForm({ directLogin = false }: { directLogin?: boolean }) {
  const { t } = useAdminI18n()
  const [state, action] = useActionState(requestAdminLink, initialActionState)
  return <form className="admin-form" action={action}><FormStatus state={{ ...state, message: t(state.message ?? '') }} /><label>{t('Email')}<input type="email" name="email" autoComplete="email" required /></label><AdminSubmitButton className="primary-action submit-button" pendingLabel={t(directLogin ? 'Signing in…' : 'Sending…')}>{t(directLogin ? 'Sign in' : 'Send magic link')}</AdminSubmitButton></form>
}
