import { adminChineseMessages, adminRecordLabels } from '@/lib/admin/messages'

export type AdminLanguage = 'en' | 'zh'
export const adminLanguageCookie = 'rein_admin_locale'

export function normalizeAdminLanguage(value: string | undefined): AdminLanguage {
  return value === 'zh' ? 'zh' : 'en'
}

export function createAdminI18n(language: AdminLanguage) {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const t = (message: string, values: Record<string, string | number> = {}) => {
    const translated = language === 'zh' && Object.hasOwn(adminChineseMessages, message) ? adminChineseMessages[message] : message
    return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : placeholder,
    )
  }

  return {
    language,
    locale,
    t,
    label: (value: string) => t(Object.hasOwn(adminRecordLabels, value) ? adminRecordLabels[value] : value),
    number: (value: number) => new Intl.NumberFormat(locale).format(value),
    attempts: (count: number) => language === 'zh'
      ? `${new Intl.NumberFormat(locale).format(count)} 次尝试`
      : `${new Intl.NumberFormat(locale).format(count)} ${count === 1 ? 'attempt' : 'attempts'}`,
  }
}
