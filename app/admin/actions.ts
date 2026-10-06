'use server'

import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { databaseRelation } from '@/lib/supabase/database-names'
import { sendConversationInvitation, sendResourceUpdate } from '@/lib/email'
import { sendContributorVerification } from '@/lib/email'
import { isPublicHttpUrl } from '@/lib/community/schemas'
import { isAgentModel, isAgentReasoningEffort } from '@/lib/agent/options'
import { publicEnv } from '@/lib/env'
import { createVerificationToken, isGithubUsername, isPlausibleEmail, normalizeEmail, normalizeGithubUsername } from '@/lib/security'

function value(formData: FormData, key: string) { return String(formData.get(key) ?? '').trim() }
function nullable(formData: FormData, key: string) { return value(formData, key) || null }
function assertSlug(slug: string) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Use a lowercase, hyphenated slug.') }
function assertUuid(id: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Contact ID is invalid.') }
function assertExternalUrl(url: string, httpsOnly = false) {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('Use a complete external URL.') }
  if (!isPublicHttpUrl(url) || (httpsOnly && parsed.protocol !== 'https:')) throw new Error('Use an allowed public external URL.')
}

async function audit(action: string, entityType: string, entityId?: string | null, details: Record<string, unknown> = {}) {
  const { user, service } = await requireAdmin()
  await service.from('admin_audit_log').insert({ actor_type: 'admin', actor_id: user.id, action, entity_type: entityType, entity_id: entityId ?? null, details })
}

async function uploadImage(formData: FormData, folder: string) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return null
  const allowed = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])
  const extension = allowed.get(file.type)
  if (!extension) throw new Error('Images must be JPEG, PNG, or WebP.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.')
  if (!value(formData, 'image_alt') || !value(formData, 'image_source') || !value(formData, 'image_permission_notes')) throw new Error('Alt text, source, and permission notes are required for an image.')
  const { service } = await requireAdmin()
  const path = `${folder}/${randomUUID()}.${extension}`
  const { error } = await service.storage.from('community-images').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return service.storage.from('community-images').getPublicUrl(path).data.publicUrl
}

export async function signOut() {
  const client = await createSupabaseServerClient()
  await client?.auth.signOut()
  redirect('/admin/login')
}

export async function deleteParticipantData(formData: FormData) {
  const { service } = await requireAdmin()
  const id = value(formData, 'id')
  if (formData.get('confirm_delete') !== 'on') throw new Error('Confirm the unsubscribe and personal-data deletion.')
  const { data: contactId, error } = await service.rpc('delete_community_participant_data', { p_participant_id: id })
  if (error) throw error
  await audit('participant.unsubscribed_and_deleted', 'community_participant', id, { contact_id: contactId, count_event_retained: true })
  revalidatePath('/admin/participants')
}

export async function mergeContacts(formData: FormData) {
  const { service } = await requireAdmin()
  const source = value(formData, 'source_contact_id')
  const target = value(formData, 'target_contact_id')
  if (!source || !target || source === target) throw new Error('Choose two different contacts.')
  const { error } = await service.rpc('merge_community_contacts', { p_source_contact_id: source, p_target_contact_id: target })
  if (error) throw error
  await audit('contact.merged', 'community_contact', target, { source_contact_id: source })
  revalidatePath('/admin/participants')
  revalidatePath('/admin/contacts')
}

export async function addDirectMember(formData: FormData) {
  const { service } = await requireAdmin()
  const kind = value(formData, 'identity_kind')
  const raw = value(formData, 'identity_value')
  const source = value(formData, 'source')
  if (!['email','github'].includes(kind) || !['github_contributor','director','core_contributor','manual'].includes(source)) throw new Error('Invalid identity or source.')
  const normalized = kind === 'email' ? normalizeEmail(raw) : normalizeGithubUsername(raw)
  if (!normalized || (kind === 'email' ? !isPlausibleEmail(normalized) : !isGithubUsername(normalized))) throw new Error('Enter a valid identity.')
  const { data, error } = await service.rpc('admin_add_identity_contact', { p_identity_kind: kind, p_normalized_value: normalized, p_source: source })
  if (error) throw error
  await audit('contact.added', 'community_contact', data?.[0]?.contact_id, { kind, source })
  revalidatePath('/admin/participants')
  revalidatePath('/admin/contacts')
  revalidatePath('/admin')
}

export async function setContactRoles(formData: FormData) {
  const { user, service } = await requireAdmin()
  const contactId = value(formData, 'contact_id')
  const contributorStatus = value(formData, 'contributor_status')
  const directorStatus = value(formData, 'director_status')
  assertUuid(contactId)
  if (!['active', 'inactive'].includes(contributorStatus)) throw new Error('Contributor status is invalid.')
  if (!['active', 'inactive'].includes(directorStatus)) throw new Error('Director status is invalid.')

  const directorDisplayName = value(formData, 'director_display_name')
  const directorSlug = value(formData, 'director_slug')
  const directorRole = value(formData, 'director_role')
  if (directorStatus === 'active') {
    if (!directorDisplayName || !directorSlug || !directorRole) throw new Error('Director name, slug, and role are required when enabling Director access.')
    assertSlug(directorSlug)
  }

  const { data, error } = await service.rpc('admin_set_contact_roles', {
    p_contact_id: contactId,
    p_contributor_status: contributorStatus,
    p_director_status: directorStatus,
    p_director_display_name: directorDisplayName,
    p_director_slug: directorSlug,
    p_director_role: directorRole,
    p_actor_id: user.id,
  })
  if (error) {
    if (error.message.includes('contact_not_found')) throw new Error('Contact was not found or has been deleted.')
    if (error.message.includes('contact_has_non_director_profile')) throw new Error('Contact already has a non-Director people profile. Resolve that profile before enabling Director access.')
    if (error.message.includes('director_profile_required')) throw new Error('Director name, slug, and role are required when enabling Director access.')
    if (error.code === '23505') throw new Error('Director slug is already in use.')
    throw error
  }
  if (!data?.[0]?.contact_id) throw new Error('Could not update contact roles.')

  revalidatePath('/admin/contacts')
  revalidatePath('/admin/contributors')
  revalidatePath('/admin/people')
}

export async function setApplicationStatus(formData: FormData) {
  const { service } = await requireAdmin()
  const id = value(formData, 'id')
  const status = value(formData, 'status')
  const allowed = ['reviewing','meeting_scheduled','conversation_complete','closed']
  if (!allowed.includes(status)) throw new Error('Invalid application state.')
  const { data: application, error: applicationError } = await service.from('contributor_applications').select('email_verified_at').eq('id', id).single()
  if (applicationError || !application) throw applicationError ?? new Error('Application not found.')
  if (!application.email_verified_at && status !== 'closed') throw new Error('An unverified application cannot enter normal review.')
  const notes = nullable(formData, 'meeting_notes')
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (notes) update.meeting_notes = notes
  if (status === 'conversation_complete') update.host_decision = nullable(formData, 'host_decision')
  if (status === 'closed') { update.closed_at = new Date().toISOString(); update.retention_expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }
  const { error } = await service.from('contributor_applications').update(update).eq('id', id)
  if (error) throw error
  await audit('application.status_changed', 'contributor_application', id, { status })
  revalidatePath('/admin/applications')
}

export async function restoreApplication(formData: FormData) {
  const { service } = await requireAdmin()
  const id = value(formData, 'id')
  const { error } = await service.from('contributor_applications').update({ status: 'reviewing', auto_reject_disabled: true, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'auto_rejected')
  if (error) throw error
  await audit('application.auto_rejection_restored', 'contributor_application', id, { automatic_rejection_disabled: true })
  revalidatePath('/admin/applications')
}

export async function resendContributorVerification(formData: FormData) {
  const { service } = await requireAdmin()
  const id = value(formData, 'id')
  const { data: application, error } = await service.from('contributor_applications').select('id,email,name,status').eq('id', id).single()
  if (error || !application) throw error ?? new Error('Application not found.')
  if (application.status !== 'email_pending') throw new Error('Only email-pending applications need a new verification link.')
  const { token, hash } = createVerificationToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error: updateError } = await service.from('contributor_applications').update({ verification_token_hash: hash, verification_expires_at: expiresAt, verification_used_at: null, updated_at: new Date().toISOString() }).eq('id', id)
  if (updateError) throw updateError
  await sendContributorVerification(application.email, application.name, `${publicEnv.siteUrl}/api/contributor/verify?token=${encodeURIComponent(token)}`, id)
  await audit('application.verification_resent', 'contributor_application', id)
  revalidatePath('/admin/applications')
}

export async function inviteApplicant(formData: FormData) {
  const { service } = await requireAdmin()
  const id = value(formData, 'id')
  const { data: application, error } = await service.from('contributor_applications').select('id,email,name,status,email_verified_at').eq('id', id).single()
  if (error || !application) throw error ?? new Error('Application not found.')
  if (!application.email_verified_at || !['submitted', 'reviewing'].includes(application.status)) throw new Error('Only a verified application in review can receive an invitation.')
  const { data: setting } = await service.from('site_settings').select('setting_value').eq('setting_key', 'scheduling_url').maybeSingle()
  const schedulingUrl = setting?.setting_value
  if (!schedulingUrl) throw new Error('A scheduling URL is required in Settings.')
  assertExternalUrl(schedulingUrl, true)
  await sendConversationInvitation(application.email, application.name, schedulingUrl, id)
  await service.from('contributor_applications').update({ status: 'invitation_sent', updated_at: new Date().toISOString() }).eq('id', id)
  await audit('application.invitation_sent', 'contributor_application', id)
  revalidatePath('/admin/applications')
}

export async function createContributor(formData: FormData) {
  const { service } = await requireAdmin()
  const applicationId = value(formData, 'application_id')
  const { data: application, error } = await service.from('contributor_applications').select('id,contact_id,status,email_verified_at').eq('id', applicationId).single()
  if (error || !application) throw error ?? new Error('Application not found.')
  if (!application.email_verified_at || application.status !== 'conversation_complete') throw new Error('Complete the verified Contributor conversation before creating a Contributor record.')
  const { data: contributor, error: contributorError } = await service.from('contributors').upsert({ contact_id: application.contact_id, application_id: application.id, status: 'active', updated_at: new Date().toISOString() }, { onConflict: 'contact_id' }).select('id').single()
  if (contributorError) throw contributorError
  await service.from('contributor_applications').update({ status: 'contributor', updated_at: new Date().toISOString() }).eq('id', applicationId)
  await audit('contributor.created', 'contributor', contributor.id, { application_id: applicationId })
  revalidatePath('/admin/applications'); revalidatePath('/admin/contributors')
}

export async function designateCoreContributor(formData: FormData) {
  const { service } = await requireAdmin()
  const contributorId = value(formData, 'contributor_id')
  const directorId = value(formData, 'nominating_director_id')
  const effectiveDate = value(formData, 'effective_date')
  const slug = value(formData, 'slug'); assertSlug(slug)
  if (!effectiveDate || !directorId) throw new Error('A nominating director and effective date are required.')
  const [{ data: contributor }, { data: director }] = await Promise.all([
    service.from('contributors').select(`id,contact_id,${databaseRelation('community_contacts')}(id)`).eq('id', contributorId).eq('status', 'active').single(),
    service.from('people').select('id').eq('id', directorId).eq('person_type', 'director').single(),
  ])
  const { data: application } = await service.from('contributor_applications').select('name').eq('contact_id', contributor?.contact_id ?? '').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!contributor) throw new Error('Contributor not found.')
  if (!director) throw new Error('Nominating director not found.')
  const { data: person, error } = await service.from('people').insert({ contributor_id: contributorId, contact_id: contributor.contact_id, slug, display_name: value(formData, 'display_name') || application?.name || 'Core Contributor', person_type: 'core_contributor', role: value(formData, 'role') || 'Core Contributor', nominating_director_id: directorId, effective_date: effectiveDate, active_since: effectiveDate }).select('id').single()
  if (error) throw error
  await audit('contributor.designated_core', 'person', person.id, { contributor_id: contributorId, nominating_director_id: directorId, effective_date: effectiveDate })
  revalidatePath('/admin/contributors'); revalidatePath('/admin/people')
}

export async function createPerson(formData: FormData) {
  const { service } = await requireAdmin()
  const slug = value(formData, 'slug'); assertSlug(slug)
  const personType = value(formData, 'person_type')
  if (!['director','core_contributor'].includes(personType)) throw new Error('Invalid person type.')
  const contributorId = nullable(formData, 'contributor_id')
  const nominatingDirectorId = nullable(formData, 'nominating_director_id')
  const effectiveDate = nullable(formData, 'effective_date')
  let contactId: string | null = null

  if (personType === 'core_contributor') {
    if (!contributorId || !nominatingDirectorId || !effectiveDate) throw new Error('Core Contributors require an existing Contributor, a nominating director, and an effective date.')
    const [{ data: contributor }, { data: director }] = await Promise.all([
      service.from('contributors').select('contact_id').eq('id', contributorId).eq('status', 'active').single(),
      service.from('people').select('id').eq('id', nominatingDirectorId).eq('person_type', 'director').single(),
    ])
    if (!contributor?.contact_id) throw new Error('Select an active Contributor.')
    if (!director) throw new Error('Select a valid nominating director.')
    contactId = contributor.contact_id
  } else {
    const identityKind = value(formData, 'identity_kind')
    const rawIdentity = value(formData, 'identity_value')
    if (!['email', 'github'].includes(identityKind) || !rawIdentity) throw new Error('Directors require an email or GitHub identity for all-time member counting.')
    const normalizedIdentity = identityKind === 'email' ? normalizeEmail(rawIdentity) : normalizeGithubUsername(rawIdentity)
    if (!normalizedIdentity || (identityKind === 'email' ? !isPlausibleEmail(normalizedIdentity) : !isGithubUsername(normalizedIdentity))) throw new Error('Enter a valid director identity.')
    const { data: identity, error: identityError } = await service.rpc('admin_add_identity_contact', {
      p_identity_kind: identityKind,
      p_normalized_value: normalizedIdentity,
      p_source: 'director',
    })
    if (identityError || !identity?.[0]?.contact_id) throw identityError ?? new Error('Could not record the director identity.')
    contactId = identity[0].contact_id
  }
  const profileUrls = {
    website_url: nullable(formData, 'website_url'), github_url: nullable(formData, 'github_url'),
    scholar_url: nullable(formData, 'scholar_url'), linkedin_url: nullable(formData, 'linkedin_url'),
  }
  for (const url of Object.values(profileUrls)) if (url) assertExternalUrl(url, true)
  const photoUrl = await uploadImage(formData, 'people')
  const record = {
    contact_id: contactId,
    slug, display_name: value(formData, 'display_name'), person_type: personType, role: value(formData, 'role'),
    responsibilities: nullable(formData, 'responsibilities'), biography: nullable(formData, 'biography'), region: nullable(formData, 'region'),
    ...profileUrls,
    current_work: nullable(formData, 'current_work'), active_since: nullable(formData, 'active_since'),
    contributor_id: contributorId, nominating_director_id: nominatingDirectorId, effective_date: effectiveDate,
    photo_url: photoUrl, photo_alt: photoUrl ? value(formData, 'image_alt') : null, photo_source: photoUrl ? value(formData, 'image_source') : null, photo_permission_notes: photoUrl ? value(formData, 'image_permission_notes') : null,
  }
  const { data, error } = await service.from('people').insert(record).select('id').single()
  if (error) throw error
  await audit('person.created', 'person', data.id, { person_type: personType })
  revalidatePath('/admin/people')
}

export async function setPersonPublication(formData: FormData) {
  const { service } = await requireAdmin()
  const id = value(formData, 'id'); const status = value(formData, 'status')
  if (!['draft','published','withdrawn','archived'].includes(status)) throw new Error('Invalid publication status.')
  const update: Record<string, unknown> = { publication_status: status, featured: formData.get('featured') === 'on', updated_at: new Date().toISOString() }
  if (status === 'published') {
    if (formData.get('publication_consent') !== 'on') throw new Error('Separate publication consent must be confirmed.')
    update.publication_consent_at = new Date().toISOString()
  }
  if (status === 'withdrawn') { update.featured = false; update.publication_consent_at = null }
  const { error } = await service.from('people').update(update).eq('id', id)
  if (error) throw error
  await audit('person.publication_changed', 'person', id, { status, featured: update.featured })
  revalidatePath('/admin/people'); revalidatePath('/community/people'); revalidatePath('/community'); revalidatePath('/')
}

export async function updatePerson(formData: FormData) {
  const { service } = await requireAdmin(); const id = value(formData, 'id')
  const update: Record<string, unknown> = {
    display_name: value(formData, 'display_name'), role: value(formData, 'role'), responsibilities: nullable(formData, 'responsibilities'),
    biography: nullable(formData, 'biography'), region: nullable(formData, 'region'), current_work: nullable(formData, 'current_work'),
    active_since: nullable(formData, 'active_since'), website_url: nullable(formData, 'website_url'), github_url: nullable(formData, 'github_url'),
    scholar_url: nullable(formData, 'scholar_url'), linkedin_url: nullable(formData, 'linkedin_url'), sort_order: Number(value(formData, 'sort_order') || 100), updated_at: new Date().toISOString(),
  }
  for (const url of [update.website_url,update.github_url,update.scholar_url,update.linkedin_url]) if (typeof url === 'string') assertExternalUrl(url, true)
  const photoUrl = await uploadImage(formData, 'people')
  if (photoUrl) Object.assign(update, { photo_url: photoUrl, photo_alt: value(formData,'image_alt'), photo_source: value(formData,'image_source'), photo_permission_notes: value(formData,'image_permission_notes') })
  const { error } = await service.from('people').update(update).eq('id',id); if (error) throw error
  await audit('person.updated','person',id)
  revalidatePath(`/admin/people/${id}`); revalidatePath('/admin/people'); revalidatePath('/community/people'); revalidatePath('/community'); revalidatePath('/')
}

export async function createResource(formData: FormData) {
  const { service } = await requireAdmin()
  const slug = value(formData, 'slug'); assertSlug(slug)
  const publicUrl = value(formData, 'public_url'); assertExternalUrl(publicUrl)
  const { data, error } = await service.from('resources').insert({ slug, title: value(formData, 'title'), summary: value(formData, 'summary'), public_url: publicUrl, resource_type: value(formData, 'resource_type'), language: value(formData, 'language'), difficulty: nullable(formData, 'difficulty'), topics: value(formData, 'topics').split(',').map((item) => item.trim()).filter(Boolean), author_publisher: nullable(formData, 'author_publisher'), access_notes: nullable(formData, 'access_notes') }).select('id').single()
  if (error) throw error
  await audit('resource.created', 'resource', data.id)
  revalidatePath('/admin/learn')
}

export async function setResourcePublication(formData: FormData) {
  const { user, service } = await requireAdmin(); const id = value(formData, 'id'); const status = value(formData, 'status')
  if (!['draft','published','archived'].includes(status)) throw new Error('Invalid resource status.')
  if (status === 'published' && formData.get('access_verified') !== 'on') throw new Error('Confirm that the resource is approved, free, and publicly accessible before publishing.')
  const update = { publication_status: status, featured: formData.get('featured') === 'on', sort_order: Number(value(formData, 'sort_order') || 100), published_at: status === 'published' ? new Date().toISOString() : null, access_verified_at: status === 'published' ? new Date().toISOString() : undefined, access_verified_by: status === 'published' ? user.id : undefined, updated_at: new Date().toISOString() }
  const { error } = await service.from('resources').update(update).eq('id', id); if (error) throw error
  await audit('resource.publication_changed', 'resource', id, update)
  revalidatePath('/admin/learn'); revalidatePath('/community/learn')
}

export async function updateResource(formData: FormData) {
  const { service } = await requireAdmin(); const id = value(formData,'id'); const publicUrl = value(formData,'public_url'); assertExternalUrl(publicUrl)
  const { error } = await service.from('resources').update({ title:value(formData,'title'), summary:value(formData,'summary'), public_url:publicUrl, resource_type:value(formData,'resource_type'), language:value(formData,'language'), difficulty:nullable(formData,'difficulty'), topics:value(formData,'topics').split(',').map((item)=>item.trim()).filter(Boolean), author_publisher:nullable(formData,'author_publisher'), access_notes:nullable(formData,'access_notes'), access_verified_at:null, access_verified_by:null, publication_status:'draft', published_at:null, updated_at:new Date().toISOString() }).eq('id',id); if (error) throw error
  await audit('resource.updated','resource',id)
  revalidatePath(`/admin/learn/${id}`); revalidatePath(`/admin/learn/preview/${id}`); revalidatePath('/admin/learn'); revalidatePath('/community/learn')
}

export async function reviewResourceSubmission(formData: FormData) {
  const { user, service } = await requireAdmin(); const id = value(formData, 'id'); const outcome = value(formData, 'outcome')
  if (!['changes_requested','approved','rejected'].includes(outcome)) throw new Error('Invalid review outcome.')
  const { data: submission, error } = await service.from('resource_submissions').select('*').eq('id', id).single(); if (error || !submission) throw error ?? new Error('Submission not found.')
  let createdResourceId = submission.created_resource_id
  if (outcome === 'approved' && !createdResourceId) {
    const baseSlug = submission.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `resource-${id.slice(0, 8)}`
    const { data: resource, error: resourceError } = await service.from('resources').insert({ slug: `${baseSlug}-${id.slice(0, 6)}`, title: submission.title, summary: submission.description.slice(0, 600), public_url: submission.public_url, resource_type: submission.format, language: submission.language, author_publisher: submission.author_publisher, publication_status: 'draft', source_submission_id: id }).select('id').single()
    if (resourceError) throw resourceError
    createdResourceId = resource.id
  }
  await service.from('resource_submissions').update({ status: outcome, reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: nullable(formData, 'review_notes'), created_resource_id: createdResourceId, updated_at: new Date().toISOString() }).eq('id', id)
  await sendResourceUpdate(submission.contact_email, submission.title, outcome.replace('_', ' '), id)
  await audit('resource_submission.reviewed', 'resource_submission', id, { outcome, created_resource_id: createdResourceId })
  revalidatePath('/admin/resources'); revalidatePath('/admin/learn')
}

export async function createEvent(formData: FormData) {
  const { service } = await requireAdmin(); const slug = value(formData, 'slug'); assertSlug(slug)
  const timezone = value(formData, 'timezone'); try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { throw new Error('Use a valid IANA timezone.') }
  const registration = value(formData, 'external_registration_url'); assertExternalUrl(registration, true)
  const relationship = value(formData, 'relationship'); const approval = nullable(formData, 'approval_reference')
  if (['Partner event','Official conference event'].includes(relationship) && !approval) throw new Error('Partner and official conference claims require an approval reference.')
  const imageUrl = await uploadImage(formData, 'events')
  const starts = DateTime.fromISO(value(formData, 'starts_at'), { zone: timezone }); const ends = DateTime.fromISO(value(formData, 'ends_at'), { zone: timezone }); if (!starts.isValid || !ends.isValid || ends <= starts) throw new Error('Enter a valid first session in the selected timezone.')
  const { data: event, error } = await service.from('events').insert({ slug, title: value(formData, 'title'), summary: value(formData, 'summary'), body: nullable(formData, 'body'), format: value(formData, 'format'), timezone, country: nullable(formData, 'country'), state_region: nullable(formData, 'state_region'), city: nullable(formData, 'city'), venue_description: nullable(formData, 'venue_description'), attendance_limit: value(formData, 'attendance_limit') ? Number(value(formData, 'attendance_limit')) : null, attendance_status: value(formData, 'attendance_status') || 'open', external_registration_url: registration, organizers: nullable(formData, 'organizers'), partners: nullable(formData, 'partners'), conference_relationship: nullable(formData, 'conference_relationship'), relationship, approval_reference: approval, image_url: imageUrl, image_alt: imageUrl ? value(formData, 'image_alt') : null, image_source: imageUrl ? value(formData, 'image_source') : null, image_permission_notes: imageUrl ? value(formData, 'image_permission_notes') : null }).select('id').single()
  if (error) throw error
  const { error: sessionError } = await service.from('event_sessions').insert({ event_id: event.id, starts_at: starts.toUTC().toISO(), ends_at: ends.toUTC().toISO(), sort_order: 1 }); if (sessionError) throw sessionError
  await audit('event.created', 'event', event.id)
  revalidatePath('/admin/gather')
}

export async function setEventPublication(formData: FormData) {
  const { service } = await requireAdmin(); const id = value(formData, 'id'); const status = value(formData, 'status')
  if (!['draft','published','cancelled','archived'].includes(status)) throw new Error('Invalid event status.')
  const { error } = await service.from('events').update({ publication_status: status, attendance_status: value(formData, 'attendance_status'), published_at: status === 'published' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error
  await audit('event.publication_changed', 'event', id, { status })
  revalidatePath('/admin/gather'); revalidatePath('/community/gather')
}

export async function updateEvent(formData: FormData) {
  const { service } = await requireAdmin(); const id=value(formData,'id'); const timezone=value(formData,'timezone'); try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}) } catch { throw new Error('Use a valid IANA timezone.') }
  const registration=value(formData,'external_registration_url'); assertExternalUrl(registration,true); const relationship=value(formData,'relationship'); const approval=nullable(formData,'approval_reference'); if (['Partner event','Official conference event'].includes(relationship) && !approval) throw new Error('An approval reference is required.')
  const imageUrl=await uploadImage(formData,'events')
  const update:Record<string,unknown>={ title:value(formData,'title'),summary:value(formData,'summary'),body:nullable(formData,'body'),format:value(formData,'format'),timezone,country:nullable(formData,'country'),state_region:nullable(formData,'state_region'),city:nullable(formData,'city'),venue_description:nullable(formData,'venue_description'),attendance_limit:value(formData,'attendance_limit')?Number(value(formData,'attendance_limit')):null,external_registration_url:registration,organizers:nullable(formData,'organizers'),partners:nullable(formData,'partners'),conference_relationship:nullable(formData,'conference_relationship'),relationship,approval_reference:approval,updated_at:new Date().toISOString() }
  if (imageUrl) Object.assign(update,{ image_url:imageUrl,image_alt:value(formData,'image_alt'),image_source:value(formData,'image_source'),image_permission_notes:value(formData,'image_permission_notes') })
  const { error }=await service.from('events').update(update).eq('id',id); if(error) throw error
  await audit('event.updated','event',id); revalidatePath(`/admin/gather/${id}`); revalidatePath('/admin/gather'); revalidatePath('/community/gather')
}

export async function addEventSession(formData: FormData) {
  const { service } = await requireAdmin(); const eventId=value(formData,'event_id'); const {data:event,error}=await service.from('events').select('timezone').eq('id',eventId).single(); if(error||!event) throw error??new Error('Event not found.')
  const starts=DateTime.fromISO(value(formData,'starts_at'),{zone:event.timezone}); const ends=DateTime.fromISO(value(formData,'ends_at'),{zone:event.timezone}); if(!starts.isValid||!ends.isValid||ends<=starts) throw new Error('Enter a valid session range.')
  const {error:insertError}=await service.from('event_sessions').insert({event_id:eventId,starts_at:starts.toUTC().toISO(),ends_at:ends.toUTC().toISO(),sort_order:Number(value(formData,'sort_order')||100)}); if(insertError) throw insertError
  await audit('event.session_added','event',eventId); revalidatePath(`/admin/gather/${eventId}`); revalidatePath('/admin/gather'); revalidatePath('/community/gather')
}

export async function saveSetting(formData: FormData) {
  const { user, service } = await requireAdmin(); const key = value(formData, 'setting_key'); const rawSettingValue = value(formData, 'setting_value')
  if (!['scheduling_url','github_repository_url','github_event_url','github_campus_url','github_technical_url','email_identity'].includes(key)) throw new Error('Unknown setting.')
  const settingValue = key === 'email_identity' ? normalizeEmail(rawSettingValue) : rawSettingValue
  if (key.includes('url')) assertExternalUrl(settingValue, true)
  if (key === 'email_identity' && !isPlausibleEmail(settingValue)) throw new Error('Enter a valid monitored contact email.')
  const { error } = await service.from('site_settings').upsert({ setting_key: key, setting_value: settingValue, updated_by: user.id, updated_at: new Date().toISOString() }); if (error) throw error
  await audit('setting.updated', 'site_setting', null, { key })
  revalidatePath('/admin/settings')
  if (key === 'email_identity') { revalidatePath('/privacy'); revalidatePath('/community/code-of-conduct') }
}

export async function saveAgentSettings(formData: FormData) {
  const { user, service } = await requireAdmin()
  const model = value(formData, 'openai_model')
  const reasoningEffort = value(formData, 'openai_reasoning_effort')
  if (!isAgentModel(model)) throw new Error('Select a supported GPT-5.6 model.')
  if (!isAgentReasoningEffort(reasoningEffort)) throw new Error('Select a supported reasoning effort.')

  const updatedAt = new Date().toISOString()
  const { error } = await service.from('site_settings').upsert([
    { setting_key: 'openai_model', setting_value: model, updated_by: user.id, updated_at: updatedAt },
    { setting_key: 'openai_reasoning_effort', setting_value: reasoningEffort, updated_by: user.id, updated_at: updatedAt },
  ])
  if (error) throw error
  await audit('agent_configuration.updated', 'site_setting', null, { model, reasoning_effort: reasoningEffort })
  revalidatePath('/admin/settings')
}

export type AdminFormActionId =
  | 'add_direct_member'
  | 'add_event_session'
  | 'create_contributor'
  | 'create_event'
  | 'create_person'
  | 'create_resource'
  | 'delete_participant_data'
  | 'designate_core_contributor'
  | 'invite_applicant'
  | 'merge_contacts'
  | 'resend_contributor_verification'
  | 'restore_application'
  | 'review_resource_submission'
  | 'save_agent_settings'
  | 'save_setting'
  | 'set_contact_roles'
  | 'set_application_status'
  | 'set_event_publication'
  | 'set_person_publication'
  | 'set_resource_publication'
  | 'update_event'
  | 'update_person'
  | 'update_resource'

export type AdminFormActionState = {
  status: 'idle' | 'success' | 'error'
  message: string
}

const adminFormActions: Record<AdminFormActionId, (formData: FormData) => Promise<unknown>> = {
  add_direct_member: addDirectMember,
  add_event_session: addEventSession,
  create_contributor: createContributor,
  create_event: createEvent,
  create_person: createPerson,
  create_resource: createResource,
  delete_participant_data: deleteParticipantData,
  designate_core_contributor: designateCoreContributor,
  invite_applicant: inviteApplicant,
  merge_contacts: mergeContacts,
  resend_contributor_verification: resendContributorVerification,
  restore_application: restoreApplication,
  review_resource_submission: reviewResourceSubmission,
  save_agent_settings: saveAgentSettings,
  save_setting: saveSetting,
  set_contact_roles: setContactRoles,
  set_application_status: setApplicationStatus,
  set_event_publication: setEventPublication,
  set_person_publication: setPersonPublication,
  set_resource_publication: setResourcePublication,
  update_event: updateEvent,
  update_person: updatePerson,
  update_resource: updateResource,
}

function safeAdminFormError(error: unknown) {
  const fallback = 'We could not complete this action. Review the fields and try again.'
  if (!(error instanceof Error)) return fallback
  if (process.env.NODE_ENV === 'development') return error.message
  return /^(A |Alt text|An approval|Application|Choose|Confirm|Contact|Contributor|Core Contributors|Could not|Director|Directors|Enter|Event|Images|Invalid|Nominating|Only|Partner|Select|This|Use)/.test(error.message)
    ? error.message
    : fallback
}

export async function runAdminFormAction(
  _previous: AdminFormActionState,
  formData: FormData,
): Promise<AdminFormActionState> {
  const actionId = value(formData, '_admin_action') as AdminFormActionId
  const action = adminFormActions[actionId]
  if (!action) return { status: 'error', message: 'This action is not available. Refresh the page and try again.' }
  formData.delete('_admin_action')
  try {
    await action(formData)
    return { status: 'success', message: '' }
  } catch (error) {
    return { status: 'error', message: safeAdminFormError(error) }
  }
}

export type AgentReviewActionState = {
  status: 'idle' | 'success' | 'error'
  message: string
}

export async function startAgentReview(
  _previous: AgentReviewActionState,
  formData: FormData,
): Promise<AgentReviewActionState> {
  const { user, service } = await requireAdmin()
  const id = value(formData, 'id')
  if (!id) return { status: 'error', message: 'The Agent job could not be identified. Refresh the page and try again.' }

  const { data: job, error: jobError } = await service
    .from('agent_jobs')
    .select('id,job_type,record_id,status')
    .eq('id', id)
    .maybeSingle()

  if (jobError || !job) return { status: 'error', message: 'The Agent job could not be found. Refresh the page and try again.' }
  if (!['contributor_application', 'resource_submission'].includes(job.job_type)) {
    return { status: 'error', message: 'This job type does not support Agent review.' }
  }
  if (!['pending', 'retry', 'failed'].includes(job.status)) {
    return { status: 'error', message: 'This Agent job is not waiting for a manual review.' }
  }

  if (job.job_type === 'contributor_application') {
    const { data: application, error } = await service
      .from('contributor_applications')
      .select('email_verified_at,status')
      .eq('id', job.record_id)
      .maybeSingle()
    if (error || !application) return { status: 'error', message: 'The Contributor application could not be found.' }
    if (!application.email_verified_at) return { status: 'error', message: 'Verify the applicant’s email before starting Agent review.' }
    if (!['submitted', 'agent_processing'].includes(application.status)) {
      return { status: 'error', message: 'This application has moved beyond the stage where Agent review can start.' }
    }
  } else {
    const { data: submission, error } = await service
      .from('resource_submissions')
      .select('status')
      .eq('id', job.record_id)
      .maybeSingle()
    if (error || !submission) return { status: 'error', message: 'The resource submission could not be found.' }
    if (!['pending', 'in_review'].includes(submission.status)) {
      return { status: 'error', message: 'This resource has moved beyond the stage where Agent review can start.' }
    }
  }

  const now = new Date().toISOString()
  const { error: updateError } = await service
    .from('agent_jobs')
    .update({ status: job.status === 'pending' ? 'pending' : 'retry', available_at: now, last_error: null, updated_at: now })
    .eq('id', id)
    .in('status', ['pending', 'retry', 'failed'])

  if (updateError) return { status: 'error', message: 'The Agent job could not be prepared. Refresh the page and try again.' }

  const { error: auditError } = await service.from('admin_audit_log').insert({
    actor_type: 'admin',
    actor_id: user.id,
    action: 'agent_job.review_started',
    entity_type: job.job_type,
    entity_id: job.record_id,
    details: { agent_job_id: job.id, previous_status: job.status },
  })
  if (auditError) return { status: 'error', message: 'The review could not be recorded in the audit log, so the Agent was not started.' }

  const { processAgentJob } = await import('@/lib/agent/process')
  const outcome = await processAgentJob(id)
  revalidatePath('/admin')
  revalidatePath(job.job_type === 'contributor_application' ? '/admin/applications' : '/admin/resources')

  if (!outcome.processed) {
    return {
      status: 'error',
      message: outcome.error
        ? 'Agent review did not complete. The job remains available for an administrator to retry.'
        : 'Another process changed this Agent job. Refresh the page to see its current status.',
    }
  }

  return {
    status: 'success',
    message: job.job_type === 'contributor_application'
      ? 'Application Agent review completed.'
      : 'Resource Agent review completed.',
  }
}
