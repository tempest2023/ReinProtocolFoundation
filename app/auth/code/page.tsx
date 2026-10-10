import type { Metadata } from 'next'
import { AdminLanguageSwitcher } from '@/components/admin-i18n'
import { CodeSignInForm } from '@/components/auth/code-sign-in-form'
import { getAdminI18n } from '@/lib/admin/i18n-server'
import { emailOtpLength } from '@/lib/auth/verification-server'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Email verification code', robots: { index: false, follow: false } }

export default async function CodeSignInPage() {
  const { t } = await getAdminI18n()
  return <main className="admin-login"><section className="admin-login__panel auth-panel">
    <AdminLanguageSwitcher /><p className="eyebrow">Rein Protocol Foundation</p>
    <h1>{t('Sign in with a code')}</h1><p>{t('Enter the email address and verification code from your sign-in email.')}</p>
    <CodeSignInForm otpLength={emailOtpLength()} />
    <p className="auth-footer"><a href="/admin/login">{t('Request a new sign-in email')}</a></p>
  </section></main>
}
