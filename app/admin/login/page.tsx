import Link from 'next/link'
import { AdminLoginForm } from '@/app/admin/login/login-form'
import { adminReadiness, isDirectAdminLoginEnabled } from '@/lib/env'

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const readiness = adminReadiness()
  const directLogin = isDirectAdminLoginEnabled()
  return <main className="admin-login"><section className="admin-login__panel"><p className="eyebrow">Private administration</p><h1>Rein Dashboard</h1><p>{directLogin ? 'Development mode: authorized administrators can sign in directly with email. No message will be sent.' : 'Authorized administrators sign in with a one-time Supabase magic link. There is no public administrator registration.'}</p>{error === 'not_authorized' ? <div className="form-status" data-kind="error" role="alert">This account is not authorized.</div> : null}{!readiness.ready ? <div className="form-status" data-kind="error"><strong>Administrative access is environment-controlled.</strong><p>Required configuration: {readiness.missing.join(', ')}</p></div> : <AdminLoginForm directLogin={directLogin} />}<p><Link href="/">Return to the public site</Link></p></section></main>
}
