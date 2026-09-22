import Link from 'next/link'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseRelation } from '@/lib/supabase/database-names'

const relationships = ['Independent','Beneficence-hosted','Co-hosted','Partner event','Official conference event']

export default async function GatherAdminPage() {
  const { service } = await requireAdmin()
  const { data: events } = await service.from('events').select(`*,${databaseRelation('event_sessions')}(*)`).order('created_at',{ ascending:false })
  return (
    <main className="admin-main">
      <header className="admin-heading"><div><p className="eyebrow">Publishing</p><h1>Gather</h1><p>Publish event details and link each event to its external registration.</p></div><Link className="admin-button admin-button--quiet" href="/community/gather" target="_blank">View public page ↗</Link></header>
      <div className="admin-stack">
        <details className="admin-create-panel">
          <summary><strong>Create event</strong><span>Add the first session and registration link</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="create_event" successMessage="Event draft created.">
            <label>Title<input name="title" required /></label>
            <label>Slug<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="event-name" required /></label>
            <label className="admin-field--wide">Summary<textarea name="summary" required /></label>
            <label className="admin-field--wide">Description<textarea name="body" /></label>
            <label>Event format<select name="format"><option value="online">Online</option><option value="in_person">In person</option><option value="hybrid">Hybrid</option></select></label>
            <label>Timezone<input name="timezone" placeholder="America/Los_Angeles" required /></label>
            <label>First session starts<input type="datetime-local" name="starts_at" required /></label>
            <label>First session ends<input type="datetime-local" name="ends_at" required /></label>
            <label className="admin-field--wide">External registration URL<input type="url" name="external_registration_url" placeholder="https://…" required /></label>
            <label>Attendance status<select name="attendance_status"><option value="open">Open</option><option value="waitlist">Waitlist</option><option value="full">Full</option><option value="closed">Closed</option></select></label>
            <label>Display attendance limit<input type="number" name="attendance_limit" min="1" /></label>
            <details className="admin-disclosure admin-field--wide">
              <summary>Location</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>Country<input name="country" /></label>
                <label>State or region<input name="state_region" /></label>
                <label>City<input name="city" /></label>
                <label>Public venue description<input name="venue_description" /></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide">
              <summary>Organizers and relationships</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label>Classification<select name="relationship">{relationships.map((relationship) => <option key={relationship} value={relationship}>{relationship === 'Beneficence-hosted' ? 'Rein-hosted' : relationship}</option>)}</select></label>
                <label>Internal approval reference <small>Required for Partner and Official events</small><input name="approval_reference" /></label>
                <label>Organizers<textarea name="organizers" /></label>
                <label>Partners<textarea name="partners" /></label>
                <label className="admin-field--wide">Conference relationship<textarea name="conference_relationship" /></label>
              </div>
            </details>
            <details className="admin-disclosure admin-field--wide">
              <summary>Event image</summary>
              <div className="admin-disclosure__body admin-form__section">
                <label className="admin-field--wide">Image <small>JPEG, PNG, or WebP; maximum 10 MB</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
                <label>Alt text<input name="image_alt" /></label>
                <label>Source<input name="image_source" /></label>
                <label className="admin-field--wide">Permission notes<textarea name="image_permission_notes" /></label>
              </div>
            </details>
            <AdminSubmitButton pendingLabel="Creating event…">Create event draft</AdminSubmitButton>
          </AdminForm>
        </details>
        <aside className="admin-note">The external platform manages capacity, waitlists, cancellations, check-in, and attendee information. Partner and official event claims require an approval reference.</aside>
        {events?.length ? (
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event</th><th>Schedule</th><th>Relationship</th><th>Publication</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}>
            <td><strong>{event.title}</strong><br /><a href={event.external_registration_url} target="_blank" rel="noreferrer">Registration ↗</a><br/><Link href={`/admin/gather/${event.id}`}>Edit event</Link></td>
            <td>{event.event_sessions?.map((session:{id:string;starts_at:string}) => <div key={session.id}>{new Intl.DateTimeFormat('en-US',{ dateStyle:'medium',timeStyle:'short',timeZone:event.timezone }).format(new Date(session.starts_at))}<br /><small>{event.timezone}</small></div>)}</td>
            <td>{event.relationship === 'Beneficence-hosted' ? 'Rein-hosted' : event.relationship}<br /><small>{event.approval_reference}</small></td>
            <td><AdminForm className="admin-form admin-row-form" actionId="set_event_publication" successMessage="Event status saved."><input type="hidden" name="id" value={event.id} /><label>Status<select name="status" defaultValue={event.publication_status}><option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option><option value="archived">Archived</option></select></label><label>Attendance<select name="attendance_status" defaultValue={event.attendance_status}><option value="open">Open</option><option value="waitlist">Waitlist</option><option value="full">Full</option><option value="closed">Closed</option></select></label><AdminSubmitButton pendingLabel="Saving…">Save event</AdminSubmitButton></AdminForm></td>
          </tr>)}</tbody></table></div>
        ) : <div className="admin-empty"><strong>No events yet</strong><span>Create an event draft when the schedule is ready.</span></div>}
      </div>
    </main>
  )
}
