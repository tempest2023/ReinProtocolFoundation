import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { adminEmails } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSecretClient } from '@/lib/supabase/secret'

export async function isAllowedAdminUser(user: { id: string; email?: string }) {
  if (!user.email) return false
  if (adminEmails().has(user.email.toLowerCase())) return true
  const { data, error } = await requireSecretClient().from('admin_users').select('active').eq('user_id', user.id).maybeSingle()
  if (error) throw new Error('admin_authorization_unavailable')
  return Boolean(data?.active)
}

export const requireAdmin = cache(async function requireAdmin() {
  const authClient = await createSupabaseServerClient()
  if (!authClient) redirect('/admin/login?error=not_configured')
  const { data: { user } } = await authClient.auth.getUser()
  if (!user?.email) redirect('/admin/login')
  const email = user.email.toLowerCase()
  const service = requireSecretClient()
  const envAllowed = adminEmails().has(email)
  const { data: existing } = await service.from('admin_users').select('active').eq('user_id', user.id).maybeSingle()
  if (!envAllowed && !existing?.active) redirect('/admin/login?error=not_authorized')
  await service.from('admin_users').upsert({ user_id: user.id, email, active: true, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return { user, service }
})

export async function isAllowedAdminEmail(email: string) {
  const normalized = email.toLowerCase()
  if (adminEmails().has(normalized)) return true
  const service = requireSecretClient()
  const { data } = await service.from('admin_users').select('active').eq('email', normalized).maybeSingle()
  return Boolean(data?.active)
}
