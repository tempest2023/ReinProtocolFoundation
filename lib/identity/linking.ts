import 'server-only'
import { getSecretClient } from '@/lib/supabase/secret'
import {
  generateBindingCode,
  generateEmailReceiptToken,
  generateNumericCode,
  generateSessionToken,
  hashValue,
  maskEmail,
} from '@/lib/agent/credentials'
import { normalizeEmail } from '@/lib/security'

/**
 * Platform identity binding.
 *
 * The binding has two independent proofs, and neither one is a chat claim:
 *
 *   1. address control, proven by a receipt link the website emails to an
 *      address already registered with the organization, and
 *   2. account control, proven by a separate short-lived code that is shown
 *      only in the browser after step 1 and typed back in the chat platform.
 *
 * Only the database decides the outcome. Every state change here calls one
 * guarded function that holds the row locks it needs, so a concurrent
 * administrator revocation and a completion serialize instead of racing.
 */

/** Provisional, pending owner confirmation: a finished binding lasts ten years. */
export const BINDING_VALIDITY = '10 years'
/** Provisional, pending owner confirmation: the emailed receipt is good for ten minutes. */
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
/** The website page itself is not a credential, so it expires quickly. */
export const LINK_SESSION_TTL_MS = 30 * 60 * 1000
/** The channel-binding code a person types into chat. */
export const BINDING_CODE_TTL_MS = 10 * 60 * 1000

export const EMAIL_CHALLENGES_PER_SESSION = 5
export const EMAIL_CHALLENGES_PER_IP = 20

export interface LinkTuple {
  platform: string
  workspaceId: string
  platformUserId: string
  channelId: string
}

export interface LinkSession {
  sessionToken: string
  expiresAt: string
}

/** Open one binding session for a platform tuple that a verified event produced. */
export async function issueLinkSession(
  tuple: LinkTuple,
  createdByCallerId: string | null,
): Promise<{ ok: true; session: LinkSession } | { ok: false; reason: string }> {
  const client = getSecretClient()
  if (!client) return { ok: false, reason: 'not_configured' }

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + LINK_SESSION_TTL_MS).toISOString()
  const { error } = await client.from('rein_link_sessions').insert({
    platform: tuple.platform,
    platform_workspace_id: tuple.workspaceId,
    platform_user_id: tuple.platformUserId,
    platform_channel_id: tuple.channelId,
    session_token_hash: hashValue(sessionToken),
    created_by_caller_id: createdByCallerId,
    expires_at: expiresAt,
  })
  if (error) return { ok: false, reason: 'unavailable' }
  return { ok: true, session: { sessionToken, expiresAt } }
}

interface SessionRow {
  id: string
  platform: string
  platform_workspace_id: string
  platform_user_id: string
  platform_channel_id: string
  state: string
  expires_at: string
  contact_id: string | null
  email_verified_at: string | null
}

export interface SessionView {
  id: string
  state: string
  platform: string
  workspaceId: string
  platformUserId: string
  channelId: string
  expiresAt: string
  contactId: string | null
}

/** Read one session by its raw token. Used by the website page and by status. */
export async function lookupLinkSession(sessionToken: string): Promise<SessionView | null> {
  const client = getSecretClient()
  if (!client) return null
  const { data } = await client
    .from('rein_link_sessions')
    .select('id,platform,platform_workspace_id,platform_user_id,platform_channel_id,state,expires_at,contact_id,email_verified_at')
    .eq('session_token_hash', hashValue(sessionToken))
    .maybeSingle<SessionRow>()
  if (!data) return null
  return {
    id: data.id,
    state: data.state,
    platform: data.platform,
    workspaceId: data.platform_workspace_id,
    platformUserId: data.platform_user_id,
    channelId: data.platform_channel_id,
    expiresAt: data.expires_at,
    contactId: data.contact_id,
  }
}

export interface IssuedEmailChallenge {
  ok: true
  receiptToken: string
  code: string
  emailMasked: string
  expiresAt: string
}

/**
 * Record one email challenge for a session and return the values the caller
 * emails to the person. The caller must not return them in any HTTP response:
 * the receipt link is the proof, so publishing it would defeat the flow.
 */
export async function issueEmailChallenge(input: {
  sessionToken: string
  email: string
  ipHash: string | null
}): Promise<IssuedEmailChallenge | { ok: false; reason: string }> {
  const client = getSecretClient()
  if (!client) return { ok: false, reason: 'not_configured' }

  const email = normalizeEmail(input.email)
  const receiptToken = generateEmailReceiptToken()
  const code = generateNumericCode()
  const codeExpiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString()

  const { data, error } = await client.rpc('rein_issue_link_email_challenge', {
    p_session_token_hash: hashValue(input.sessionToken),
    p_email: email,
    p_email_hash: hashValue(email),
    p_email_masked: maskEmail(email),
    p_receipt_token_hash: hashValue(receiptToken),
    p_code_hash: hashValue(code),
    p_code_expires_at: codeExpiresAt,
    p_ip_hash: input.ipHash,
    p_max_per_session: EMAIL_CHALLENGES_PER_SESSION,
    p_max_per_ip: EMAIL_CHALLENGES_PER_IP,
  })
  if (error) return { ok: false, reason: 'unavailable' }
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row || row.ok !== true) {
    return { ok: false, reason: typeof row?.reason === 'string' ? row.reason : 'unavailable' }
  }
  return { ok: true, receiptToken, code, emailMasked: maskEmail(email), expiresAt: codeExpiresAt }
}

export interface ConfirmedEmail {
  ok: true
  emailMasked: string
  contactId: string | null
  outcome: string
  bindingCode: string
  bindingExpiresAt: string
}

/**
 * Confirm the emailed receipt and hand the browser its channel-binding code.
 * A wrong code increments an attempt counter and consumes nothing.
 */
export async function confirmLinkEmail(input: {
  sessionToken: string
  receiptToken: string
  email: string
  code?: string | null
}): Promise<ConfirmedEmail | { ok: false; reason: string }> {
  const client = getSecretClient()
  if (!client) return { ok: false, reason: 'not_configured' }

  const email = normalizeEmail(input.email)
  const bindingCode = generateBindingCode()
  const bindingExpiresAt = new Date(Date.now() + BINDING_CODE_TTL_MS).toISOString()
  const { data, error } = await client.rpc('rein_confirm_link_email', {
    p_session_token_hash: hashValue(input.sessionToken),
    p_receipt_token_hash: hashValue(input.receiptToken),
    p_code_hash: input.code ? hashValue(input.code.trim()) : null,
    p_binding_code_hash: hashValue(bindingCode),
    p_binding_expires_at: bindingExpiresAt,
    p_email: email,
  })
  if (error) return { ok: false, reason: 'unavailable' }
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row || row.ok !== true) {
    return { ok: false, reason: typeof row?.reason === 'string' ? row.reason : 'unavailable' }
  }
  return {
    ok: true,
    emailMasked: String(row.email_masked ?? ''),
    contactId: (row.contact_id as string | null) ?? null,
    outcome: String(row.outcome ?? 'verified'),
    bindingCode,
    bindingExpiresAt,
  }
}

export interface CompletedLink {
  ok: true
  contactId: string | null
  linkId: string | null
  platform: string
  workspaceId: string
  platformUserId: string
}

/** Finish the binding once the person types the code back in their channel. */
export async function completePlatformLink(input: {
  sessionToken: string
  bindingCode: string
  tuple: Pick<LinkTuple, 'platform' | 'workspaceId' | 'platformUserId'>
  actorType: 'agent' | 'admin' | 'system'
}): Promise<CompletedLink | { ok: false; reason: string }> {
  const client = getSecretClient()
  if (!client) return { ok: false, reason: 'not_configured' }
  const { data, error } = await client.rpc('rein_complete_platform_link', {
    p_session_token_hash: hashValue(input.sessionToken),
    p_binding_code_hash: hashValue(input.bindingCode.trim()),
    p_validity: BINDING_VALIDITY,
    p_platform: input.tuple.platform,
    p_workspace_id: input.tuple.workspaceId,
    p_platform_user_id: input.tuple.platformUserId,
    p_actor_type: input.actorType,
  })
  if (error) return { ok: false, reason: 'unavailable' }
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row || row.ok !== true) {
    return { ok: false, reason: typeof row?.reason === 'string' ? row.reason : 'unavailable' }
  }
  return {
    ok: true,
    contactId: (row.contact_id as string | null) ?? null,
    linkId: (row.link_id as string | null) ?? null,
    platform: String(row.platform ?? ''),
    workspaceId: String(row.platform_workspace_id ?? ''),
    platformUserId: String(row.platform_user_id ?? ''),
  }
}

export async function revokePlatformLink(input: {
  linkId: string
  actor: string
  reason: string
  actorType: 'agent' | 'admin'
}): Promise<{ ok: true; reason: string; contactId: string | null } | { ok: false; reason: string }> {
  const client = getSecretClient()
  if (!client) return { ok: false, reason: 'not_configured' }
  const { data, error } = await client.rpc('rein_revoke_platform_link', {
    p_link_id: input.linkId,
    p_actor: input.actor,
    p_reason: input.reason,
    p_actor_type: input.actorType,
  })
  if (error) return { ok: false, reason: 'unavailable' }
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row || row.ok !== true) {
    return { ok: false, reason: typeof row?.reason === 'string' ? row.reason : 'unavailable' }
  }
  return {
    ok: true,
    reason: String(row.reason ?? 'revoked'),
    contactId: (row.contact_id as string | null) ?? null,
  }
}

export interface ResolvedIdentity {
  status: 'resolved' | 'identity_not_linked' | 'identity_revoked' | 'identity_expired'
  contactId: string | null
  isActiveContributor: boolean
  isDirector: boolean
}

/** Re-derive a platform identity and its current human standing, every time. */
export async function resolvePlatformIdentity(
  tuple: Pick<LinkTuple, 'platform' | 'workspaceId' | 'platformUserId'>,
): Promise<ResolvedIdentity | null> {
  const client = getSecretClient()
  if (!client) return null
  const { data, error } = await client.rpc('rein_resolve_platform_contact', {
    p_platform: tuple.platform,
    p_workspace_id: tuple.workspaceId,
    p_platform_user_id: tuple.platformUserId,
  })
  if (error) return null
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row) return null
  return {
    status: String(row.status ?? 'identity_not_linked') as ResolvedIdentity['status'],
    contactId: (row.contact_id as string | null) ?? null,
    isActiveContributor: row.is_active_contributor === true,
    isDirector: row.is_director === true,
  }
}

/** A director, or the proposal's own author, may apply a recorded revision. */
export async function canApplyRevision(contactId: string, proposalId: string): Promise<boolean> {
  const client = getSecretClient()
  if (!client) return false
  const { data, error } = await client.rpc('rein_apply_permission', {
    p_contact_id: contactId,
    p_proposal_id: proposalId,
  })
  if (error) return false
  return data === true
}
