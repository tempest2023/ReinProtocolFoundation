import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { INDUSTRIES } from '@/lib/community/constants'
import { sanitizePostgrestSearch } from '@/lib/security'

export default async function ParticipantsPage({ searchParams }: { searchParams: Promise<{ industry?: string; location?: string }> }) {
  const { t, label } = await getAdminI18n()
  const filters = await searchParams
  const { service } = await requireAdmin()
  let query = service.from('community_participants').select('*').order('created_at',{ ascending: false }).limit(200)
  if (filters.industry) query = query.eq('industry', filters.industry)
  const location = filters.location ? sanitizePostgrestSearch(filters.location) : ''
  if (location) query = query.or(`country.ilike.%${location}%,city_region.ilike.%${location}%,us_state.ilike.%${location}%`)
  const { data: participants } = await query
  const exportHref = `/api/admin/participants/export?industry=${encodeURIComponent(filters.industry ?? '')}&location=${encodeURIComponent(filters.location ?? '')}`

  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Community')}</p><h1>{t('Participants')}</h1><p>{t('Find contacts, manage subscriptions, and reconcile identities.')}</p></div></header>
      <div className="admin-toolbar">
        <form className="admin-form admin-toolbar__form" method="get">
          <label>{t('Industry')}<select name="industry" defaultValue={filters.industry ?? ''}><option value="">{t('All industries')}</option>{INDUSTRIES.map((industry) => <option key={industry} value={industry}>{t(industry)}</option>)}</select></label>
          <label>{t('Location')}<input name="location" defaultValue={filters.location ?? ''} placeholder={t('Country, state, city, or region')} /></label>
          <AdminSubmitButton pendingLabel={t('Filtering…')}>{t('Apply filters')}</AdminSubmitButton>
        </form>
        <Link className="admin-button admin-button--quiet" href={exportHref}>{t('Export CSV')}</Link>
      </div>
      <div className="admin-grid" style={{ marginBottom: '1rem' }}>
        <details className="admin-create-panel">
          <summary><strong>{t('Add member')}</strong><span>{t('GitHub, director, or manual source')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="add_direct_member" successMessage={t('Member record added.')}>
            <label>{t('Identity type')}<select name="identity_kind"><option value="github">{t('GitHub username')}</option><option value="email">{t('Email')}</option></select></label>
            <label>{t('Source')}<select name="source"><option value="github_contributor">{t('Direct GitHub contributor')}</option><option value="director">{t('Director')}</option><option value="core_contributor">{t('Core Contributor')}</option><option value="manual">{t('Manual')}</option></select></label>
            <label className="admin-field--wide">{t('Email or GitHub username')}<input name="identity_value" required /></label>
            <AdminSubmitButton pendingLabel={t('Adding member…')}>{t('Add or match member')}</AdminSubmitButton>
          </AdminForm>
        </details>
        <details className="admin-create-panel">
          <summary><strong>{t('Merge contacts')}</strong><span>{t('Move one identity into another')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="merge_contacts" successMessage={t('Contacts merged.')}>
            <label>{t('Source contact ID')}<input name="source_contact_id" required /></label>
            <label>{t('Target contact ID')}<input name="target_contact_id" required /></label>
            <p className="admin-note admin-field--wide">{t('The source identity moves to the target contact. Historical count events remain unchanged.')}</p>
            <AdminSubmitButton pendingLabel={t('Merging contacts…')}>{t('Merge contacts')}</AdminSubmitButton>
          </AdminForm>
        </details>
      </div>
      {participants?.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table"><thead><tr><th>{t('Participant')}</th><th>{t('Industry')}</th><th>{t('Location')}</th><th>{t('Status')}</th><th>{t('Contact ID')}</th><th>{t('Privacy')}</th></tr></thead>
            <tbody>{participants.map((participant) => <tr key={participant.id}>
              <td><strong>{participant.name || t('Unnamed')}</strong><br /><small>{participant.email}</small></td>
              <td>{label(participant.industry)}{participant.industry_other ? ` — ${participant.industry_other}` : ''}</td>
              <td>{[participant.city_region,participant.us_state,participant.country].filter(Boolean).join(', ')}</td>
              <td><span className="status-badge">{label(participant.subscription_status)}</span></td>
              <td><code>{participant.contact_id}</code></td>
              <td><details className="admin-disclosure"><summary>{t('Delete data')}</summary><div className="admin-disclosure__body"><AdminForm actionId="delete_participant_data" successMessage={t('Personal data deleted.')}><input type="hidden" name="id" value={participant.id} /><label className="admin-check"><input type="checkbox" name="confirm_delete" required /> {t('Confirm permanent deletion. The anonymous count remains.')}</label><AdminSubmitButton className="admin-button admin-button--quiet" pendingLabel={t('Deleting…')}>{t('Unsubscribe and delete')}</AdminSubmitButton></AdminForm></div></details></td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : <div className="admin-empty"><strong>{t('No matching participants')}</strong><span>{t('Adjust the filters or add a member above.')}</span></div>}
    </main>
  )
}
