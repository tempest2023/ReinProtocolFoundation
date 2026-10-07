'use client'

import { useAdminI18n } from '@/components/admin-i18n'


export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useAdminI18n()
  return <main className="admin-main"><section className="admin-panel"><p className="eyebrow">{t('Administrative error')}</p><h1>{t('This operation could not be completed.')}</h1><p>{t(error.message)}</p><button className="admin-button" type="button" onClick={reset}>{t('Try again')}</button></section></main>
}
