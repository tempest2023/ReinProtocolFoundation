'use client'

import { useFormStatus } from 'react-dom'
import { useAdminI18n } from '@/components/admin-i18n'

export function AdminSubmitButton({
  children,
  pendingLabel = 'Saving…',
  className = 'admin-button',
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
}) {
  const { t } = useAdminI18n()
  const { pending } = useFormStatus()
  return <button className={className} type="submit" disabled={pending}>{pending ? t(pendingLabel) : children}</button>
}
