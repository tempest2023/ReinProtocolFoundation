import { getAdminI18n } from '@/lib/admin/i18n-server'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseRelation } from '@/lib/supabase/database-names'

export default async function ContributorsPage() {
  const { t, label, locale } = await getAdminI18n()
  const { service } = await requireAdmin()
  const [{ data: contributors }, { data: directors }, { data: corePeople }] = await Promise.all([
    service.from('contributors').select(`*,${databaseRelation('contributor_applications')}(name,email)`).order('became_contributor_at',{ ascending:false }),
    service.from('people').select('id,display_name').eq('person_type','director').order('display_name'),
    service.from('people').select('contributor_id').eq('person_type','core_contributor'),
  ])
  const designated = new Set((corePeople ?? []).map((person) => person.contributor_id))

  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Community')}</p><h1>{t('Contributors')}</h1><p>{t('Manage private Contributor records and director-nominated Core Contributors.')}</p></div></header>
      <details className="admin-create-panel" style={{ marginBottom: '1rem' }}>
        <summary><strong>{t('Designate Core Contributor')}</strong><span>{t('Director nomination and effective date')}</span></summary>
        <AdminForm className="admin-form admin-form--grid" actionId="designate_core_contributor" successMessage={t('Core Contributor designation recorded.')}>
          <label>{t('Existing Contributor')}<select name="contributor_id" required defaultValue=""><option value="" disabled>{t('Select a Contributor')}</option>{contributors?.filter((c) => !designated.has(c.id)).map((contributor) => <option value={contributor.id} key={contributor.id}>{contributor.contributor_applications?.name ?? contributor.id}</option>)}</select></label>
          <label>{t('Nominating director')}<select name="nominating_director_id" required defaultValue=""><option value="" disabled>{t('Select a director')}</option>{directors?.map((director) => <option value={director.id} key={director.id}>{director.display_name}</option>)}</select></label>
          <label>{t('Effective date')}<input type="date" name="effective_date" required /></label>
          <label>{t('Public role')}<input name="role" defaultValue="Core Contributor" required /></label>
          <label>{t('Public display name')}<input name="display_name" required /></label>
          <label>{t('Profile slug')}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
          {!directors?.length ? <p className="form-status admin-field--wide" data-kind="error">{t('Add a director in People before recording a Core Contributor.')}</p> : null}
          <AdminSubmitButton pendingLabel={t('Recording designation…')}>{t('Create draft profile')}</AdminSubmitButton>
        </AdminForm>
      </details>
      {contributors?.length ? (
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t('Contributor')}</th><th>{t('Status')}</th><th>{t('Contributor since')}</th><th>{t('Core')}</th></tr></thead><tbody>{contributors.map((contributor) => <tr key={contributor.id}><td><strong>{contributor.contributor_applications?.name ?? t('Direct contributor')}</strong><br /><small>{contributor.contributor_applications?.email ?? t('No application email')}</small></td><td><span className="status-badge">{label(contributor.status)}</span></td><td>{new Intl.DateTimeFormat(locale,{ dateStyle:'medium' }).format(new Date(contributor.became_contributor_at))}</td><td>{designated.has(contributor.id) ? t('Yes') : t('No')}</td></tr>)}</tbody></table></div>
      ) : <div className="admin-empty"><strong>{t('No Contributors yet')}</strong><span>{t('Accepted applicants will appear here.')}</span></div>}
    </main>
  )
}
