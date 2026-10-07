import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireAdmin } from '@/lib/admin/auth'
import { signOut } from '@/app/admin/actions'
import { AdminNavigation } from '@/components/admin-navigation'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { AdminLanguageSwitcher } from '@/components/admin-i18n'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getAdminI18n()
  const { user } = await requireAdmin()
  return (
    <div className="admin-dashboard">
      <a className="skip-link" href="#admin-content">{t('Skip to admin content')}</a>
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-brand">
          <span>Rein</span>
          <small>{t('Administration')}</small>
        </Link>
        <Suspense fallback={<div className="admin-nav-loading" aria-hidden="true" />}>
          <AdminNavigation />
        </Suspense>
        <div className="admin-user">
          <AdminLanguageSwitcher />
          <span className="admin-user__label">{t('Signed in')}</span>
          <span className="admin-user__email">{user.email}</span>
          <form action={signOut}>
            <AdminSubmitButton className="admin-button admin-button--quiet" pendingLabel={t('Signing out…')}>{t('Sign out')}</AdminSubmitButton>
          </form>
        </div>
      </aside>
      <div className="admin-content" id="admin-content">{children}</div>
    </div>
  )
}
