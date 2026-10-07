import { getAdminI18n } from '@/lib/admin/i18n-server'
import Link from 'next/link'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseRelation } from '@/lib/supabase/database-names'

const relationships = ['Independent','Beneficence-hosted','Co-hosted','Partner event','Official conference event']

export default async function GatherAdminPage() {
  const { t, locale } = await getAdminI18n()
  const { service } = await requireAdmin()
  const { data: events } = await service.from('events').select(`*,${databaseRelation('event_sessions')}(*)`).order('created_at',{ ascending:false })
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">{t('Publishing')}</p><h1>{t('Gather')}</h1><p>{t('Publish event details and link each event to its external registration.')}</p></div><Link className="admin-button admin-button--quiet" href="/community/gather" target="_blank">{t('View public page ↗')}</Link></header>
      <div className="admin-stack">
        <details className="admin-create-panel">
          <summary><strong>{t('Create event')}</strong><span>{t('Add the first session and registration link')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="create_event" successMessage={t('Event draft created.')}>
            <label>{t('Title')}<input name="title" required /></label>
            <label>{t('Slug')}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="event-name" required /></label>
            <label className="admin-field--wide">{t('Summary')}<textarea name="summary" required /></label>
            <label className="admin-field--wide">{t('Description')}<textarea name="body" /></label>
            <label>{t('Event format')}<select name="format"><option value="online">{t('Online')}</option><option value="in_person">{t('In person')}</option><option value="hybrid">{t('Hybrid')}</option></select></label>
            <label>{t('Timezone')}<input name="timezone" placeholder="America/Los_Angeles" required /></label>
            <label>{t('First session starts')}<input type="datetime-local" name="starts_at" required /></label>
            <label>{t('First session ends')}<input type="datetime-local" name="ends_at" required /></label>
            <label className="admin-field--wide">{t('External registration URL')}<input type="url" name="external_registration_url" placeholder="https://…" required /></label>
            <label>{t('Attendance status')}<select name="attendance_status"><option value="open">{t('Open')}</option><option value="waitlist">{t('Waitlist')}</option><option value="full">{t('Full')}</option><option value="closed">{t('Closed')}</option></select></label>
            <label>{t('Display attendance limit')}<input type="number" name="attendance_limit" min="1" /></label>
            <details className="admin-disclosure admin-field--wide">
              <summary>{t('Location')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>{t('Country')}<input name="country" /></label>
                <label>{t('State or region')}<input name="state_region" /></label>
                <label>{t('City')}<input name="city" /></label>
                <label>{t('Public venue description')}<input name="venue_description" /></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide">
              <summary>{t('Organizers and relationships')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>{t('Classification')}<select name="relationship">{relationships.map((relationship) => <option key={relationship} value={relationship}>{t(relationship === 'Beneficence-hosted' ? t('Rein-hosted') : relationship)}</option>)}</select></label>
                <label>{t('Internal approval reference')} <small>{t('Required for Partner and Official events')}</small><input name="approval_reference" /></label>
                <label>{t('Organizers')}<textarea name="organizers" /></label>
                <label>{t('Partners')}<textarea name="partners" /></label>
                <label className="admin-field--wide">{t('Conference relationship')}<textarea name="conference_relationship" /></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide">
              <summary>{t('Event image')}</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label className="admin-field--wide">{t('Image')} <small>{t('JPEG, PNG, or WebP; maximum 10 MB')}</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
                <label>{t('Alt text')}<input name="image_alt" /></label>
                <label>{t('Source')}<input name="image_source" /></label>
                <label className="admin-field--wide">{t('Permission notes')}<textarea name="image_permission_notes" /></label>
              </div>
            </details>
            <AdminSubmitButton pendingLabel={t('Creating event…')}>{t('Create event draft')}</AdminSubmitButton>
          </AdminForm>
        </details>
        <aside className="admin-note">{t('The external platform manages capacity, waitlists, cancellations, check-in, and attendee information. Partner and official event claims require an approval reference.')}</aside>
        {events?.length ? (
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t('Event')}</th><th>{t('Schedule')}</th><th>{t('Relationship')}</th><th>{t('Publication')}</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}>
            <td><strong>{event.title}</strong><br /><a href={event.external_registration_url} target="_blank" rel="noreferrer">{t('Registration ↗')}</a><br/><Link href={`/admin/gather/${event.id}`}>{t('Edit event')}</Link></td>
            <td>{event.event_sessions?.map((session:{id:string;starts_at:string}) => <div key={session.id}>{new Intl.DateTimeFormat(locale,{ dateStyle:'medium',timeStyle:'short',timeZone:event.timezone }).format(new Date(session.starts_at))}<br /><small>{event.timezone}</small></div>)}</td>
            <td>{t(event.relationship === 'Beneficence-hosted' ? 'Rein-hosted' : event.relationship)}<br /><small>{event.approval_reference}</small></td>
            <td><AdminForm className="admin-form admin-row-form" actionId="set_event_publication" successMessage={t('Event status saved.')}><input type="hidden" name="id" value={event.id} /><label>{t('Status')}<select name="status" defaultValue={event.publication_status}><option value="draft">{t('Draft')}</option><option value="published">{t('Published')}</option><option value="cancelled">{t('Cancelled')}</option><option value="archived">{t('Archived')}</option></select></label><label>{t('Attendance')}<select name="attendance_status" defaultValue={event.attendance_status}><option value="open">{t('Open')}</option><option value="waitlist">{t('Waitlist')}</option><option value="full">{t('Full')}</option><option value="closed">{t('Closed')}</option></select></label><AdminSubmitButton pendingLabel={t('Saving…')}>{t('Save event')}</AdminSubmitButton></AdminForm></td>
          </tr>)}</tbody></table></div>
        ) : <div className="admin-empty"><strong>{t('No events yet')}</strong><span>{t('Create an event draft when the schedule is ready.')}</span></div>}
      </div>
    </main>
  )
}
