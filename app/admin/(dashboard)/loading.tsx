'use client'

import { useAdminI18n } from '@/components/admin-i18n'
export default function AdminRouteLoading() {
  const { t } = useAdminI18n()
  return (
    <main className="admin-main admin-route-loading" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{t('Loading administration section…')}</span>
      <header className="admin-loading-heading" aria-hidden="true">
        <span className="admin-loading-line admin-loading-line--eyebrow" />
        <span className="admin-loading-line admin-loading-line--title" />
        <span className="admin-loading-line admin-loading-line--copy" />
      </header>
      <div className="admin-loading-panel" aria-hidden="true">
        <span className="admin-loading-line admin-loading-line--wide" />
        <span className="admin-loading-line admin-loading-line--medium" />
        <span className="admin-loading-line admin-loading-line--wide" />
        <span className="admin-loading-line admin-loading-line--short" />
      </div>
    </main>
  )
}
