import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseEnvironment } from '@/lib/supabase/database-names'

type ContactRow = {
  id: string
  first_source: string
  created_at: string
  last_seen_at: string
  deleted_at: string | null
}

type ContactIdentity = {
  contact_id: string
  identity_kind: string
  normalized_value: string
}

type Participant = {
  contact_id: string
  name: string | null
  email: string
  subscription_status: string
}

type Contributor = {
  id: string
  contact_id: string
  status: 'active' | 'inactive'
  became_contributor_at: string
}

type Person = {
  id: string
  contact_id: string | null
  contributor_id: string | null
  slug: string
  display_name: string
  person_type: 'director' | 'core_contributor'
  role: string
  authorization_status: 'active' | 'inactive'
  publication_status: string
}

type PlatformLink = {
  id: string
  contact_id: string
  platform: string
  platform_workspace_id: string
  platform_user_id: string
  status: string
  validity_expires_at: string
  verified_at: string
  revoked_at: string | null
  revoked_reason: string | null
}

function groupByContact<Row extends { contact_id: string }>(rows: Row[]) {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) grouped.set(row.contact_id, [...(grouped.get(row.contact_id) ?? []), row])
  return grouped
}

function suggestSlug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'director'
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const search = q.trim().toLowerCase()
  const { service } = await requireAdmin()
  const { data: rawContacts, error: contactsError } = await service
    .from('community_contacts')
    .select('id,first_source,created_at,last_seen_at,deleted_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (contactsError) throw contactsError

  const contacts = (rawContacts ?? []) as ContactRow[]
  const contactIds = contacts.map((contact) => contact.id)
  const empty = { data: [], error: null }
  const [identityResult, participantResult, contributorResult, peopleResult, linkResult] = contactIds.length
    ? await Promise.all([
      service.from('contact_identities').select('contact_id,identity_kind,normalized_value').in('contact_id', contactIds).order('created_at'),
      service.from('community_participants').select('contact_id,name,email,subscription_status').in('contact_id', contactIds),
      service.from('contributors').select('id,contact_id,status,became_contributor_at').in('contact_id', contactIds),
      service.from('people').select('id,contact_id,contributor_id,slug,display_name,person_type,role,authorization_status,publication_status'),
      service.from('rein_platform_links').select('id,contact_id,platform,platform_workspace_id,platform_user_id,status,validity_expires_at,verified_at,revoked_at,revoked_reason').in('contact_id', contactIds).order('verified_at', { ascending: false }),
    ])
    : [empty, empty, empty, empty, empty]

  for (const result of [identityResult, participantResult, contributorResult, peopleResult, linkResult]) {
    if (result.error) throw result.error
  }

  const identities = groupByContact((identityResult.data ?? []) as ContactIdentity[])
  const participants = new Map(((participantResult.data ?? []) as Participant[]).map((row) => [row.contact_id, row]))
  const contributors = new Map(((contributorResult.data ?? []) as Contributor[]).map((row) => [row.contact_id, row]))
  const links = groupByContact((linkResult.data ?? []) as PlatformLink[])
  const people = (peopleResult.data ?? []) as Person[]
  const contributorContacts = new Map(Array.from(contributors.values()).map((row) => [row.id, row.contact_id]))
  const peopleByContact = new Map<string, Person[]>()
  for (const person of people) {
    const contactId = person.contact_id ?? (person.contributor_id ? contributorContacts.get(person.contributor_id) : undefined)
    if (contactId) peopleByContact.set(contactId, [...(peopleByContact.get(contactId) ?? []), person])
  }

  const records = contacts.filter((contact) => {
    if (!search) return true
    const values = [
      contact.id,
      contact.first_source,
      participants.get(contact.id)?.name,
      participants.get(contact.id)?.email,
      ...(identities.get(contact.id) ?? []).flatMap((identity) => [identity.identity_kind, identity.normalized_value]),
      ...(peopleByContact.get(contact.id) ?? []).flatMap((person) => [person.display_name, person.role, person.slug]),
      ...(links.get(contact.id) ?? []).flatMap((link) => [link.platform, link.platform_workspace_id, link.platform_user_id]),
    ]
    return values.some((candidate) => candidate?.toLowerCase().includes(search))
  })

  return (
    <main className="admin-main">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Community · {databaseEnvironment().toUpperCase()}</p>
          <h1>Contacts</h1>
          <p>Manage canonical identities, inspect chat bindings, and set current Contributor or Director authorization.</p>
        </div>
        <span className="status-badge">{databaseEnvironment()} database</span>
      </header>

      <aside className="admin-note" style={{ marginBottom: '1rem' }}>
        These controls are an administrator trust boundary. They create registered contacts and change eligibility immediately without an email-verification step; every role change is written to the audit log.
      </aside>

      <div className="admin-grid" style={{ marginBottom: '1rem' }}>
        <details className="admin-create-panel">
          <summary><strong>Add contact</strong><span>Direct registration without email verification</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="add_direct_member" successMessage="Contact added or matched.">
            <label>Identity type<select name="identity_kind" defaultValue="email"><option value="email">Email</option><option value="github">GitHub username</option></select></label>
            <label>Registration source<select name="source" defaultValue="manual"><option value="manual">Manual</option><option value="director">Director</option><option value="core_contributor">Core Contributor</option><option value="github_contributor">GitHub contributor</option></select></label>
            <label className="admin-field--wide">Email or GitHub username<input name="identity_value" required /></label>
            <AdminSubmitButton pendingLabel="Adding contact…">Add or match contact</AdminSubmitButton>
          </AdminForm>
        </details>

        <details className="admin-create-panel">
          <summary><strong>Merge contacts</strong><span>Move one identity into another contact</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="merge_contacts" successMessage="Contacts merged.">
            <label>Source contact ID<input name="source_contact_id" required /></label>
            <label>Target contact ID<input name="target_contact_id" required /></label>
            <p className="admin-note admin-field--wide">The source identity moves to the target contact. Historical member-count events remain unchanged.</p>
            <AdminSubmitButton pendingLabel="Merging contacts…">Merge contacts</AdminSubmitButton>
          </AdminForm>
        </details>
      </div>

      <div className="admin-toolbar">
        <form className="admin-form admin-toolbar__form" method="get">
          <label>Search contacts<input name="q" defaultValue={q} placeholder="Email, name, contact ID, or platform user ID" /></label>
          <AdminSubmitButton pendingLabel="Searching…">Search</AdminSubmitButton>
        </form>
      </div>

      {records.length ? (
        <div className="admin-record-list">
          {records.map((contact) => {
            const contactIdentities = identities.get(contact.id) ?? []
            const participant = participants.get(contact.id)
            const contributor = contributors.get(contact.id)
            const contactPeople = peopleByContact.get(contact.id) ?? []
            const director = contactPeople.find((person) => person.person_type === 'director')
            const contactLinks = links.get(contact.id) ?? []
            const email = contactIdentities.find((identity) => identity.identity_kind === 'email')?.normalized_value
            const title = director?.display_name || participant?.name || email || contact.id
            const eligibility = director?.authorization_status === 'active'
              ? 'Director'
              : contributor?.status === 'active'
                ? 'Contributor'
                : 'Contact'
            const defaultName = director?.display_name || participant?.name || email?.split('@')[0] || 'Director'

            return (
              <details className="admin-record" name="community-contacts" key={contact.id}>
                <summary>
                  <span className="admin-record__title"><strong>{title}</strong><small>{email || contact.id}</small></span>
                  <span className="admin-record__meta">{contact.first_source.replaceAll('_', ' ')} · {displayDate(contact.created_at)}</span>
                  <span className="status-badge">{contact.deleted_at ? 'Deleted' : eligibility}</span>
                </summary>
                <div className="admin-record__body">
                  <section className="admin-record__section">
                    <h2>Canonical identity</h2>
                    <p><strong>Contact ID</strong><br /><code>{contact.id}</code></p>
                    <p><strong>Participant</strong><br />{participant ? `${participant.subscription_status} · ${participant.email}` : 'No participant profile'}</p>
                    {contactIdentities.length ? <ul>{contactIdentities.map((identity) => <li key={`${identity.identity_kind}:${identity.normalized_value}`}><strong>{identity.identity_kind}</strong>: {identity.normalized_value}</li>)}</ul> : <p>No identities recorded.</p>}
                    <p><small>Last seen {displayDate(contact.last_seen_at)}</small></p>
                  </section>

                  <section className="admin-record__section">
                    <h2>Platform links</h2>
                    {contactLinks.length ? <ul>{contactLinks.map((link) => <li key={link.id}><strong>{link.platform}</strong> · {link.status}<br /><small>Workspace {link.platform_workspace_id} · User {link.platform_user_id}<br />Verified {displayDate(link.verified_at)} · expires {displayDate(link.validity_expires_at)}{link.revoked_at ? ` · revoked ${displayDate(link.revoked_at)}${link.revoked_reason ? ` (${link.revoked_reason})` : ''}` : ''}</small></li>)}</ul> : <p>No Slack or Discord identity is linked.</p>}
                  </section>

                  <section className="admin-record__section">
                    <h2>Authorization</h2>
                    {contact.deleted_at ? <p>Deleted contacts cannot receive roles.</p> : (
                      <AdminForm
                        actionId="set_contact_roles"
                        resetKey={`${contact.id}:${contributor?.status ?? 'none'}:${director?.authorization_status ?? 'none'}`}
                        successMessage="Contact authorization updated."
                      >
                        <input type="hidden" name="contact_id" value={contact.id} />
                        <label>Contributor<select name="contributor_status" defaultValue={contributor?.status === 'active' ? 'active' : 'inactive'}><option value="inactive">Not active</option><option value="active">Active Contributor</option></select></label>
                        <label>Director<select name="director_status" defaultValue={director?.authorization_status === 'active' ? 'active' : 'inactive'}><option value="inactive">Not active</option><option value="active">Active Director</option></select></label>
                        <label>Director display name<input name="director_display_name" defaultValue={director?.display_name || defaultName} /></label>
                        <label>Director profile slug<input name="director_slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={director?.slug || suggestSlug(defaultName)} /></label>
                        <label>Director role<input name="director_role" defaultValue={director?.role || 'Director'} /></label>
                        {director ? <p><small>Profile publication: {director.publication_status}. Authorization is managed independently.</small></p> : null}
                        <AdminSubmitButton pendingLabel="Updating authorization…">Save authorization</AdminSubmitButton>
                      </AdminForm>
                    )}
                  </section>
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className="admin-empty"><strong>No matching contacts</strong><span>Add a contact or adjust the search.</span></div>}
    </main>
  )
}
