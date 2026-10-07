import type { Metadata } from 'next'
import { AdminI18nProvider } from '@/components/admin-i18n'
import { getAdminI18n } from '@/lib/admin/i18n-server'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getAdminI18n()
  return { title: t('Administration'), robots: { index: false, follow: false } }
}
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const { language, locale } = await getAdminI18n()
  return <AdminI18nProvider language={language}><div className="admin-shell" lang={locale}>{children}</div></AdminI18nProvider>
}
