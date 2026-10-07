'use client'

import { createContext, useContext, useId, useMemo, useState, useTransition } from 'react'
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
  const errorId = useId()

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
      <label className="admin-language-switcher">
        <span className="visually-hidden">{t('Interface language')}</span>
        <select value={language} disabled={pending} aria-busy={pending} aria-describedby={failed ? errorId : undefined} onChange={(event) => {
          const nextLanguage = event.currentTarget.value
          if (nextLanguage === 'en' || nextLanguage === 'zh') switchLanguage(nextLanguage)
        }}>
          <option value="en" lang="en">English</option>
          <option value="zh" lang="zh-CN">中文</option>
        </select>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" /></svg>
      </label>
      {failed ? <p id={errorId} className="admin-language-error" role="alert">{t('Could not change language. Please try again.')}</p> : null}
    </div>
  )
}
