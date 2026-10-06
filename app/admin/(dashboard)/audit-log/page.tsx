import { getAdminI18n } from '@/lib/admin/i18n-server'
import { requireAdmin } from '@/lib/admin/auth'

export default async function AuditLogPage() {
  const { t, locale, label } = await getAdminI18n()
  const { service } = await requireAdmin()
  const { data: entries } = await service.from('admin_audit_log').select('*').order('created_at',{ ascending:false }).limit(250)
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('System')}</p><h1>{t('Audit')}</h1><p>{t('Timestamped administrator, Agent, and system actions.')}</p></div></header>
      {entries?.length ? (
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t('Time')}</th><th>{t('Actor')}</th><th>{t('Action')}</th><th>{t('Entity')}</th><th>{t('Details')}</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Intl.DateTimeFormat(locale,{ dateStyle:'medium',timeStyle:'medium' }).format(new Date(entry.created_at))}</td><td>{label(entry.actor_type)}<br /><small>{entry.actor_id}</small></td><td>{entry.action}</td><td>{label(entry.entity_type)}<br /><small>{entry.entity_id}</small></td><td><details className="admin-disclosure"><summary>{t('Inspect JSON')}</summary><pre className="audit-json">{JSON.stringify(entry.details,null,2)}</pre></details></td></tr>)}</tbody></table></div>
      ) : <div className="admin-empty"><strong>{t('No audit entries yet')}</strong><span>{t('Administrative actions will appear here.')}</span></div>}
    </main>
  )
}
