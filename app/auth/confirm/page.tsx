import type { Metadata } from 'next'
import { AdminLanguageSwitcher } from '@/components/admin-i18n'
import { getAdminI18n } from '@/lib/admin/i18n-server'
import { EmailVerificationForm } from './verification-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Email sign-in', robots: { index: false, follow: false } }

export default async function EmailConfirmationPage() {
  const { t } = await getAdminI18n()
  return <main className="admin-login"><section className="admin-login__panel auth-panel">
    <AdminLanguageSwitcher />
    <p className="eyebrow">Rein Protocol Foundation</p>
    <EmailVerificationForm />
    <noscript><p role="alert">{t('JavaScript is required to sign in with an email link. Enable it and reopen the email, or request a verification code.')}</p></noscript>
  </section></main>
}
