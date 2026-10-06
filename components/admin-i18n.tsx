'use client'

import { createContext, useContext, useMemo, useState, useTransition } from 'react'
import { createAdminI18n, type AdminLanguage } from '@/lib/admin/i18n'
import { setAdminLanguage } from '@/app/admin/locale-actions'

const AdminI18nContext = createContext(createAdminI18n('en'))

export function AdminI18nProvider({ language, children }: { language: AdminLanguage; children: React.ReactNode }) {
  const i18n = useMemo(() => createAdminI18n(language), [language])
  return <AdminI18nContext.Provider value={i18n}>{children}</AdminI18nContext.Provider>
}

export function useAdminI18n() {
  return useContext(AdminI18nContext)
}

export function AdminLanguageSwitcher() {
  const { language, t } = useAdminI18n()
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState(false)

  function switchLanguage(nextLanguage: AdminLanguage) {
    if (nextLanguage === language) return
    setFailed(false)
    startTransition(async () => {
      try {
        await setAdminLanguage(nextLanguage)
      } catch {
        setFailed(true)
      }
    })
  }

  return (
    <div className="admin-language-control">
      <div className="admin-language-switcher" role="group" aria-label={t('Interface language')} aria-busy={pending}>
        <button type="button" lang="en" aria-pressed={language === 'en'} disabled={pending} onClick={() => switchLanguage('en')}>English</button>
        <button type="button" lang="zh-CN" aria-pressed={language === 'zh'} disabled={pending} onClick={() => switchLanguage('zh')}>中文</button>
      </div>
      {failed ? <p className="admin-language-error" role="alert">{t('Could not change language. Please try again.')}</p> : null}
    </div>
  )
}
