'use server'

import { cookies } from 'next/headers'
import { adminLanguageCookie } from '@/lib/admin/i18n'
import { publicEnv } from '@/lib/env'

export async function setAdminLanguage(language: string): Promise<void> {
  if (language !== 'en' && language !== 'zh') throw new Error('Unsupported administrator language.')
  const cookieStore = await cookies()
  // Remove the legacy route-scoped cookie so it cannot shadow the shared preference.
  cookieStore.set(adminLanguageCookie, '', { path: '/admin', maxAge: 0 })
  cookieStore.set(adminLanguageCookie, language, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && publicEnv.siteUrl.startsWith('https://'),
  })
}
