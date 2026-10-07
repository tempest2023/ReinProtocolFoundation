import { getAdminI18n } from '@/lib/admin/i18n-server'
import { notFound } from 'next/navigation'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'

export default async function EditPersonPage({ params }: { params: Promise<{ id:string }> }) {
  const { t } = await getAdminI18n()
  const { id } = await params
  const { service } = await requireAdmin()
  const { data: person } = await service.from('people').select('*').eq('id',id).maybeSingle()
  if (!person) notFound()
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('People / Edit')}</p><h1>{person.display_name}</h1><p>{t('Edit the public presentation. Nomination provenance remains fixed.')}</p></div></header>
      <section className="admin-panel">
        <AdminForm className="admin-form admin-form--grid" actionId="update_person" successMessage={t('Profile saved as a draft.')}>
          <input type="hidden" name="id" value={person.id}/>
          <label>{t('Display name')}<input name="display_name" defaultValue={person.display_name} required/></label>
          <label>{t('Role')}<input name="role" defaultValue={person.role} required/></label>
          <label className="admin-field--wide">{t('Responsibilities')}<textarea name="responsibilities" defaultValue={person.responsibilities??''}/></label>
          <label className="admin-field--wide">{t('Biography')}<textarea name="biography" defaultValue={person.biography??''}/></label>
          <label>{t('Region')}<input name="region" defaultValue={person.region??''}/></label>
          <label>{t('Active since')}<input type="date" name="active_since" defaultValue={person.active_since??''}/></label>
          <label className="admin-field--wide">{t('Current work')}<input name="current_work" defaultValue={person.current_work??''}/></label>
          <div className="admin-form__section">
            <h3>{t('Professional links')}</h3>
            <label>{t('Website')}<input type="url" name="website_url" defaultValue={person.website_url??''}/></label>
            <label>GitHub<input type="url" name="github_url" defaultValue={person.github_url??''}/></label>
            <label>Google Scholar<input type="url" name="scholar_url" defaultValue={person.scholar_url??''}/></label>
            <label>LinkedIn<input type="url" name="linkedin_url" defaultValue={person.linkedin_url??''}/></label>
            <label>{t('Manual order')}<input type="number" name="sort_order" defaultValue={person.sort_order}/></label>
          </div>
          <details className="admin-disclosure admin-field--wide">
            <summary>{t('Replace profile photo')}</summary>
            <div className="admin-disclosure__body admin-form__section">
              <label className="admin-field--wide">{t('Photo')} <small>{t('JPEG, PNG, or WebP; maximum 10 MB')}</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp"/></label>
              <label>{t('Alt text')}<input name="image_alt"/></label>
              <label>{t('Source')}<input name="image_source"/></label>
              <label className="admin-field--wide">{t('Permission notes')}<textarea name="image_permission_notes"/></label>
            </div>
          </details>
          <AdminSubmitButton pendingLabel={t('Saving profile…')}>{t('Save profile')}</AdminSubmitButton>
        </AdminForm>
      </section>
    </main>
  )
}
