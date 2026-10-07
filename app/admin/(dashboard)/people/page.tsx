import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseRelation } from '@/lib/supabase/database-names'

export default async function PeopleAdminPage() {
  const { t, label } = await getAdminI18n()
  const { service } = await requireAdmin()
  const [{ data: people }, { data: contributors }, { data: directors }] = await Promise.all([
    service.from('people').select('*').order('sort_order').order('display_name'),
    service.from('contributors').select(`id,${databaseRelation('contributor_applications')}(name)`).eq('status','active'),
    service.from('people').select('id,display_name').eq('person_type','director'),
  ])

  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Publishing')}</p><h1>{t('People')}</h1><p>{t('Manage director and Core Contributor profiles and publication consent.')}</p></div></header>
      <div className="admin-stack">
        <details className="admin-create-panel">
          <summary><strong>{t('Create profile')}</strong><span>{t('Start as a private draft')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="create_person" successMessage={t('Profile draft created.')}>
            <label>{t('Profile type')}<select name="person_type"><option value="director">{t('Director')}</option><option value="core_contributor">{t('Core Contributor')}</option></select></label>
            <label>{t('Display name or approved pseudonym')}<input name="display_name" required /></label>
            <label>{t('Role')}<input name="role" required /></label>
            <label>{t('Profile slug')}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="jane-doe" required /></label>
            <fieldset>
              <legend>{t('Organizational record')}</legend>
              <p>{t('Directors need a counting identity. Core Contributors need an existing Contributor, nominating director, and effective date.')}</p>
              <label>{t('Director identity type')}<select name="identity_kind" defaultValue="email"><option value="email">{t('Email')}</option><option value="github">{t('GitHub username')}</option></select></label>
              <label>{t('Director identity')}<input name="identity_value" /></label>
              <label>{t('Existing Contributor')}<select name="contributor_id" defaultValue=""><option value="">{t('Not applicable')}</option>{contributors?.map((contributor) => { const applications = contributor.contributor_applications as Array<{ name?: string }> | null; return <option value={contributor.id} key={contributor.id}>{applications?.[0]?.name ?? contributor.id}</option> })}</select></label>
              <label>{t('Nominating director')}<select name="nominating_director_id" defaultValue=""><option value="">{t('Not applicable')}</option>{directors?.map((director) => <option value={director.id} key={director.id}>{director.display_name}</option>)}</select></label>
              <label>{t('Effective date')}<input type="date" name="effective_date" /></label>
              <label>{t('Active since')}<input type="date" name="active_since" /></label>
            </fieldset>
            <div className="admin-form__section">
              <h3>{t('Public profile')}</h3>
              <label className="admin-field--wide">{t('Responsibilities')}<textarea name="responsibilities" /></label>
              <label className="admin-field--wide">{t('Biography')}<textarea name="biography" /></label>
              <label>{t('Region')}<input name="region" /></label>
              <label>{t('Current work')}<input name="current_work" /></label>
            </div>
            <details className="admin-disclosure admin-field--wide">
              <summary>{t('Professional links')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>{t('Website')}<input type="url" name="website_url" placeholder="https://…" /></label>
                <label>GitHub<input type="url" name="github_url" placeholder="https://github.com/…" /></label>
                <label>Google Scholar<input type="url" name="scholar_url" placeholder="https://scholar.google.com/…" /></label>
                <label>LinkedIn<input type="url" name="linkedin_url" placeholder="https://linkedin.com/in/…" /></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide">
              <summary>{t('Profile photo')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label className="admin-field--wide">{t('Photo')} <small>{t('JPEG, PNG, or WebP; maximum 10 MB')}</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
                <label>{t('Alt text')}<input name="image_alt" /></label>
                <label>{t('Source')}<input name="image_source" /></label>
                <label className="admin-field--wide">{t('Permission notes')}<textarea name="image_permission_notes" /></label>
              </div>
            </details>
            <AdminSubmitButton pendingLabel={t('Creating profile…')}>{t('Create draft profile')}</AdminSubmitButton>
          </AdminForm>
        </details>
        <aside className="admin-note">{t('Publishing requires separately recorded consent. Withdrawing consent removes the profile from public pages.')}</aside>
        {people?.length ? (
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t('Person')}</th><th>{t('Role')}</th><th>{t('Nomination')}</th><th>{t('Publication')}</th></tr></thead><tbody>{people.map((person) => <tr key={person.id}>
            <td><strong>{person.display_name}</strong><br /><small>{label(person.person_type)}</small><br/><Link href={`/admin/people/${person.id}`}>{t('Edit profile')}</Link></td>
            <td>{person.role}<br /><small>{person.region}</small></td>
            <td>{person.person_type === 'core_contributor' ? <>{t('Director')} {person.nominating_director_id}<br /><small>{t('Effective')} {person.effective_date}</small></> : t('Director')}</td>
            <td><AdminForm className="admin-form admin-row-form" actionId="set_person_publication" successMessage={t('Publication settings saved.')}><input type="hidden" name="id" value={person.id} /><label>{t('Status')}<select name="status" defaultValue={person.publication_status}><option value="draft">{t('Draft')}</option><option value="published">{t('Published')}</option><option value="withdrawn">{t('Consent withdrawn')}</option><option value="archived">{t('Archived')}</option></select></label><label className="admin-check"><input type="checkbox" name="featured" defaultChecked={person.featured} /> {t('Featured')}</label><label className="admin-check"><input type="checkbox" name="publication_consent" /> {t('Publication consent recorded')}</label><AdminSubmitButton pendingLabel={t('Saving…')}>{t('Save publication')}</AdminSubmitButton></AdminForm></td>
          </tr>)}</tbody></table></div>
        ) : <div className="admin-empty"><strong>{t('No profiles yet')}</strong><span>{t('Create the first private draft when a profile is approved.')}</span></div>}
      </div>
    </main>
  )
}
