import Link from 'next/link'
import { getAdminI18n } from '@/lib/admin/i18n-server'

export default async function AdminNotFound() {
  const { t } = await getAdminI18n()
  return (
    <main className="admin-main">
      <header className="admin-heading">
        <div><h1>{t('Page not found')}</h1><p>{t('This administrator record or page is no longer available.')}</p></div>
      </header>
      <Link className="button button--secondary" href="/admin">{t('Return to dashboard')}</Link>
    </main>
  )
}
