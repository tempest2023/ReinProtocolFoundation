import { AdminI18nProvider } from '@/components/admin-i18n'
import { getAdminI18n } from '@/lib/admin/i18n-server'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { language, locale } = await getAdminI18n()
  return <AdminI18nProvider language={language}><div className="admin-shell" lang={locale}>{children}</div></AdminI18nProvider>
}
