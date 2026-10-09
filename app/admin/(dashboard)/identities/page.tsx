import { AdminForm } from '@/components/admin-form'
import { AdminIdentityAuthorizationForm } from '@/components/admin-identity-authorization-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { requireAdmin } from '@/lib/admin/auth'
import { getAdminI18n } from '@/lib/admin/i18n-server'
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

function displayDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))
}

export default async function IdentitiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { t, label, locale } = await getAdminI18n()
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
          <p className="eyebrow">{t('Community')} · {databaseEnvironment().toUpperCase()}</p>
          <h1>{t('Rein identities')}</h1>
          <p>{t('Keep one Rein identity per person across Slack, Discord, email, and organization roles.')}</p>
        </div>
        <span className="status-badge">{t('{environment} database', { environment: databaseEnvironment() })}</span>
      </header>

      <aside className="admin-note" style={{ marginBottom: '1rem' }}>
        {t('These controls are an administrator trust boundary. They register Rein identities and change eligibility immediately without an email-verification step; every role change is written to the audit log.')}
      </aside>

      <div className="admin-grid" style={{ marginBottom: '1rem' }}>
        <details className="admin-create-panel">
          <summary><strong>{t('Register Rein identity')}</strong><span>{t('Direct registration without email verification')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="add_direct_member" successMessage={t('Rein identity added or matched.')}>
            <label>{t('Identity type')}<select name="identity_kind" defaultValue="email"><option value="email">{t('Email')}</option><option value="github">{t('GitHub username')}</option></select></label>
            <label>{t('Registration source')}<select name="source" defaultValue="manual"><option value="manual">{t('Manual')}</option><option value="director">{t('Director')}</option><option value="core_contributor">{t('Core Contributor')}</option><option value="github_contributor">{t('GitHub contributor')}</option></select></label>
            <label className="admin-field--wide">{t('Email or GitHub username')}<input name="identity_value" required /></label>
            <AdminSubmitButton pendingLabel={t('Registering identity…')}>{t('Add or match identity')}</AdminSubmitButton>
          </AdminForm>
        </details>

        <details className="admin-create-panel">
          <summary><strong>{t('Merge Rein identities')}</strong><span>{t('Combine duplicate records for the same person')}</span></summary>
          <AdminForm className="admin-form admin-form--grid" actionId="merge_contacts" successMessage={t('Rein identities merged.')}>
            <label>{t('Source Rein identity ID')}<input name="source_contact_id" required /></label>
            <label>{t('Target Rein identity ID')}<input name="target_contact_id" required /></label>
            <p className="admin-note admin-field--wide">{t('All identifiers move to the target Rein identity. Historical member-count events remain unchanged.')}</p>
            <AdminSubmitButton pendingLabel={t('Merging identities…')}>{t('Merge Rein identities')}</AdminSubmitButton>
          </AdminForm>
        </details>
      </div>

      <div className="admin-toolbar">
        <form className="admin-form admin-toolbar__form" method="get">
          <label>{t('Search Rein identities')}<input name="q" defaultValue={q} placeholder={t('Email, name, Rein identity ID, or platform user ID')} /></label>
          <AdminSubmitButton pendingLabel={t('Searching…')}>{t('Search')}</AdminSubmitButton>
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
              ? t('Director')
              : contributor?.status === 'active'
                ? t('Contributor')
                : t('Member')
            const defaultName = director?.display_name || participant?.name || email?.split('@')[0] || 'Director'

            return (
              <details className="admin-record" name="community-contacts" key={contact.id}>
                <summary>
                  <span className="admin-record__title"><strong>{title}</strong><small>{email || contact.id}</small></span>
                  <span className="admin-record__meta">{label(contact.first_source)} · {displayDate(contact.created_at, locale)}</span>
                  <span className="status-badge">{contact.deleted_at ? t('Deleted') : eligibility}</span>
                </summary>
                <div className="admin-record__body">
                  <section className="admin-record__section">
                    <h2>{t('Rein identity')}</h2>
                    <p><strong>{t('Rein identity ID')}</strong><br /><code>{contact.id}</code></p>
                    <p><strong>{t('Participant')}</strong><br />{participant ? `${label(participant.subscription_status)} · ${participant.email}` : t('No participant profile')}</p>
                    {contactIdentities.length ? <ul>{contactIdentities.map((identity) => <li key={`${identity.identity_kind}:${identity.normalized_value}`}><strong>{label(identity.identity_kind)}</strong>: {identity.normalized_value}</li>)}</ul> : <p>{t('No email or GitHub identifier recorded.')}</p>}
                    <p><small>{t('Last seen {date}', { date: displayDate(contact.last_seen_at, locale) })}</small></p>
                  </section>

                  <section className="admin-record__section">
                    <h2>{t('Platform links')}</h2>
                    {contactLinks.length ? <ul>{contactLinks.map((link) => <li key={link.id}><strong>{link.platform}</strong> · {label(link.status)}<br /><small>{t('Workspace')} {link.platform_workspace_id} · {t('User')} {link.platform_user_id}<br />{t('Verified')} {displayDate(link.verified_at, locale)} · {t('expires')} {displayDate(link.validity_expires_at, locale)}{link.revoked_at ? ` · ${t('revoked')} ${displayDate(link.revoked_at, locale)}${link.revoked_reason ? ` (${link.revoked_reason})` : ''}` : ''}</small></li>)}</ul> : <p>{t('No Slack or Discord account is linked.')}</p>}
                  </section>

                  <section className="admin-record__section">
                    <h2>{t('Agent permissions')}</h2>
                    <p>{t('These permissions control which protected actions this person can perform through the Rein Agent.')}</p>
                    {contact.deleted_at ? <p>{t('Deleted Rein identities cannot receive roles.')}</p> : (
                      <AdminIdentityAuthorizationForm
                        contactId={contact.id}
                        contributorStatus={contributor?.status === 'active' ? 'active' : 'inactive'}
                        directorStatus={director?.authorization_status === 'active' ? 'active' : 'inactive'}
                        directorDisplayName={director?.display_name || defaultName}
                        directorSlug={director?.slug || suggestSlug(defaultName)}
                        directorRole={director?.role || 'Director'}
                        directorPublicationStatus={director?.publication_status}
                        resetKey={`${contact.id}:${contributor?.status ?? 'none'}:${director?.authorization_status ?? 'none'}`}
                      />
                    )}
                  </section>
                </div>
              </details>
            )
          })}
        </div>
      ) : <div className="admin-empty"><strong>{t('No matching Rein identities')}</strong><span>{t('Register an identity or adjust the search.')}</span></div>}
    </main>
  )
}
