import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { adminLanguageCookie, createAdminI18n, normalizeAdminLanguage } from '@/lib/admin/i18n'

export const getAdminI18n = cache(async function getAdminI18n() {
  const cookieStore = await cookies()
  return createAdminI18n(normalizeAdminLanguage(cookieStore.get(adminLanguageCookie)?.value))
})
