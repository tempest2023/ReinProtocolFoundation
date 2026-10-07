import { getAdminI18n } from '@/lib/admin/i18n-server'
import { notFound } from 'next/navigation'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseRelation } from '@/lib/supabase/database-names'

const relationships = ['Independent','Beneficence-hosted','Co-hosted','Partner event','Official conference event']

export default async function EditEventPage({params}:{params:Promise<{id:string}>}) {
  const { t, locale } = await getAdminI18n()
  const { id } = await params
  const { service } = await requireAdmin()
  const { data: event } = await service.from('events').select(`*,${databaseRelation('event_sessions')}(*)`).eq('id',id).maybeSingle()
  if (!event) notFound()
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Gather / Edit')}</p><h1>{event.title}</h1><p>{t('Session times use {timezone} and are stored as UTC.', { timezone: event.timezone })}</p></div></header>
      <div className="admin-grid">
        <section className="admin-panel">
          <AdminForm className="admin-form admin-form--grid" actionId="update_event" successMessage={t('Event saved.')}>
            <input type="hidden" name="id" value={event.id}/>
            <label>{t('Title')}<input name="title" defaultValue={event.title} required/></label>
            <label>{t('Event format')}<select name="format" defaultValue={event.format}><option value="online">{t('Online')}</option><option value="in_person">{t('In person')}</option><option value="hybrid">{t('Hybrid')}</option></select></label>
            <label className="admin-field--wide">{t('Summary')}<textarea name="summary" defaultValue={event.summary} required/></label>
            <label className="admin-field--wide">{t('Description')}<textarea name="body" defaultValue={event.body??''}/></label>
            <label>{t('Timezone')}<input name="timezone" defaultValue={event.timezone} required/></label>
            <label>{t('Display attendance limit')}<input type="number" min="1" name="attendance_limit" defaultValue={event.attendance_limit??''}/></label>
            <label className="admin-field--wide">{t('External registration URL')}<input type="url" name="external_registration_url" defaultValue={event.external_registration_url} required/></label>
            <details className="admin-disclosure admin-field--wide" open>
              <summary>{t('Location')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>{t('Country')}<input name="country" defaultValue={event.country??''}/></label>
                <label>{t('State or region')}<input name="state_region" defaultValue={event.state_region??''}/></label>
                <label>{t('City')}<input name="city" defaultValue={event.city??''}/></label>
                <label>{t('Venue description')}<input name="venue_description" defaultValue={event.venue_description??''}/></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide" open>
              <summary>{t('Organizers and relationships')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>{t('Classification')}<select name="relationship" defaultValue={event.relationship}>{relationships.map((relationship)=><option key={relationship} value={relationship}>{t(relationship === 'Beneficence-hosted' ? t('Rein-hosted') : relationship)}</option>)}</select></label>
                <label>{t('Approval reference')}<input name="approval_reference" defaultValue={event.approval_reference??''}/></label>
                <label>{t('Organizers')}<textarea name="organizers" defaultValue={event.organizers??''}/></label>
                <label>{t('Partners')}<textarea name="partners" defaultValue={event.partners??''}/></label>
                <label className="admin-field--wide">{t('Conference relationship')}<textarea name="conference_relationship" defaultValue={event.conference_relationship??''}/></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide">
              <summary>{t('Replace event image')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label className="admin-field--wide">{t('Image')} <small>{t('JPEG, PNG, or WebP; maximum 10 MB')}</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp"/></label>
                <label>{t('Alt text')}<input name="image_alt"/></label>
                <label>{t('Source')}<input name="image_source"/></label>
                <label className="admin-field--wide">{t('Permission notes')}<textarea name="image_permission_notes"/></label>
              </div>
            </details>
            <AdminSubmitButton pendingLabel={t('Saving event…')}>{t('Save event')}</AdminSubmitButton>
          </AdminForm>
        </section>
        <section className="admin-panel">
          <h2>{t('Sessions')}</h2>
          {event.event_sessions?.length ? <ol>{event.event_sessions.sort((a:{starts_at:string},b:{starts_at:string})=>a.starts_at.localeCompare(b.starts_at)).map((session:{id:string;starts_at:string;ends_at:string})=><li key={session.id}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:event.timezone}).format(new Date(session.starts_at))} – {new Intl.DateTimeFormat(locale,{timeStyle:'short',timeZone:event.timezone}).format(new Date(session.ends_at))}</li>)}</ol> : <p>{t('No sessions recorded.')}</p>}
          <AdminForm actionId="add_event_session" successMessage={t('Session added.')}>
            <input type="hidden" name="event_id" value={event.id}/>
            <label>{t('Starts ({timezone})', { timezone: event.timezone })}<input type="datetime-local" name="starts_at" required/></label>
            <label>{t('Ends ({timezone})', { timezone: event.timezone })}<input type="datetime-local" name="ends_at" required/></label>
            <label>{t('Order')}<input type="number" name="sort_order" defaultValue={100}/></label>
            <AdminSubmitButton pendingLabel={t('Adding session…')}>{t('Add session')}</AdminSubmitButton>
          </AdminForm>
        </section>
      </div>
    </main>
  )
}
