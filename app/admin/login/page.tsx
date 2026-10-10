import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { AdminLoginForm } from '@/app/admin/login/login-form'
import { adminReadiness, isDirectAdminLoginEnabled } from '@/lib/env'
import { AdminLanguageSwitcher } from '@/components/admin-i18n'

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t } = await getAdminI18n()
  const { error } = await searchParams
  const readiness = adminReadiness()
  const directLogin = isDirectAdminLoginEnabled()
  return <main className="admin-login"><section className="admin-login__panel"><AdminLanguageSwitcher /><p className="eyebrow">{t('Private administration')}</p><h1>{t('Rein Dashboard')}</h1><p>{directLogin ? t('Development mode: authorized administrators can sign in directly with email. No message will be sent.') : t('Use your administrator email to sign in.')}</p>{error === 'not_authorized' ? <div className="form-status" data-kind="error" role="alert">{t('This account is not authorized.')}</div> : null}{error === 'invalid_link' ? <div className="form-status" data-kind="error" role="alert">{t('This sign-in link is invalid or expired. Request a new link.')}</div> : null}{!readiness.ready ? <div className="form-status" data-kind="error"><strong>{t('Administrative access is environment-controlled.')}</strong><p>{t('Required configuration:')} {readiness.missing.join(', ')}</p></div> : <AdminLoginForm directLogin={directLogin} />}<p><Link href="/">{t('Return to the public site')}</Link></p></section></main>
}
