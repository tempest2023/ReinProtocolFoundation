import 'server-only'
import { getSecretClient } from '@/lib/supabase/secret'
import { digestsMatch, generateServiceCredential, hashServiceCredential } from '@/lib/agent/credentials'
import {
  CALLER_ID_HEADER,
  CALLER_SECRET_HEADER,
  allowsChannel,
  allowsPlatform,
  platformAllowlistSchema,
  channelAllowlistSchema,
  isServiceScope,
  refuse,
  type MachineRefusal,
  type PlatformAllowlistEntry,
  type ServiceScope,
} from '@/lib/agent/contracts'

/**
 * Registered machine principals.
 *
 * A caller presents its identifier and secret in request headers. The body of a
 * request never carries a credential, and a caller record never carries a human
 * role: Contributor and director status are always derived from community
 * records when an operation runs, never from the caller row.
 */

export interface AuthenticatedCaller {
  callerId: string
  label: string
  scopes: readonly string[]
  platformAllowlist: readonly PlatformAllowlistEntry[]
  channelAllowlist: readonly string[]
}

type CallerRow = {
  caller_id: string
  label: string
  credential_hash: string
  scopes: string[] | null
  platform_allowlist: unknown
  channel_allowlist: unknown
  status: string
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** Read the machine credential from headers. Returns null when either part is absent. */
export function readCallerHeaders(request: Request): { callerId: string; secret: string } | null {
  const callerId = request.headers.get(CALLER_ID_HEADER)?.trim()
  const authorization = request.headers.get(CALLER_SECRET_HEADER)?.trim() ?? ''
  const secret = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
  if (!callerId || !secret) return null
  return { callerId, secret }
}

export interface CallerRequirement {
  scope: ServiceScope
  platform?: string
  workspaceId?: string
  channelId?: string
}

/**
 * Authenticate one machine request and check the scope plus the platform and
 * channel allowlists. Every failure is a closed reason code; none of them
 * reveals whether a caller id exists.
 */
export async function authenticateCaller(
  request: Request,
  requirement: CallerRequirement,
): Promise<{ ok: true; caller: AuthenticatedCaller } | MachineRefusal> {
  const headers = readCallerHeaders(request)
  if (!headers) return refuse('bad_credential', 401)

  const client = getSecretClient()
  if (!client) return refuse('not_configured', 503)

  const { data, error } = await client
    .from('rein_service_callers')
    .select('caller_id,label,credential_hash,scopes,platform_allowlist,channel_allowlist,status')
    .eq('caller_id', headers.callerId)
    .maybeSingle<CallerRow>()

  if (error) return refuse('unavailable', 503)
  if (!data) return refuse('caller_unknown', 401)

  if (!digestsMatch(data.credential_hash, hashServiceCredential(headers.secret))) {
    return refuse('bad_credential', 401)
  }
  if (data.status === 'revoked') return refuse('caller_revoked', 403)
  if (data.status !== 'enabled') return refuse('caller_disabled', 403)

  const scopes = (data.scopes ?? []).filter(isServiceScope)
  if (!scopes.includes(requirement.scope)) return refuse('scope_missing', 403)

  const platformParsed = platformAllowlistSchema.safeParse(parseJsonArray(data.platform_allowlist))
  // A stored allowlist that does not parse, or parses to nothing, grants no
  // platform. It is never widened to "all workspaces".
  if (!platformParsed.success || platformParsed.data.length === 0) {
    return refuse('platform_not_allowed', 403)
  }
  const platformAllowlist = platformParsed.data
  const channelParsed = channelAllowlistSchema.safeParse(
    parseJsonArray(data.channel_allowlist).filter((entry): entry is string => typeof entry === 'string'),
  )
  if (!channelParsed.success || channelParsed.data.length === 0) {
    return refuse('channel_not_allowed', 403)
  }
  const channelAllowlist = channelParsed.data

  if (requirement.platform && requirement.workspaceId) {
    if (!allowsPlatform(platformAllowlist, requirement.platform, requirement.workspaceId)) {
      return refuse('platform_not_allowed', 403)
    }
  }
  if (requirement.channelId && !allowsChannel(channelAllowlist, requirement.channelId)) {
    return refuse('channel_not_allowed', 403)
  }

  return {
    ok: true,
    caller: {
      callerId: data.caller_id,
      label: data.label,
      scopes,
      platformAllowlist,
      channelAllowlist,
    },
  }
}

export async function touchCaller(callerId: string): Promise<void> {
  const client = getSecretClient()
  if (!client) return
  await client
    .from('rein_service_callers')
    .update({ last_used_at: new Date().toISOString() })
    .eq('caller_id', callerId)
}

export interface RegisterCallerInput {
  callerId: string
  label: string
  scopes: readonly string[]
  platformAllowlist: readonly PlatformAllowlistEntry[]
  channelAllowlist: readonly string[]
  createdBy: string
}

/**
 * Register one machine principal. The raw credential is returned once and is
 * never recoverable afterwards; only its digest is stored.
 */
export async function registerServiceCaller(
  input: RegisterCallerInput,
): Promise<{ ok: true; credential: string } | MachineRefusal> {
  const client = getSecretClient()
  if (!client) return refuse('not_configured', 503)

  const credential = generateServiceCredential()
  const { error } = await client.from('rein_service_callers').insert({
    caller_id: input.callerId,
    label: input.label,
    credential_hash: hashServiceCredential(credential),
    scopes: [...input.scopes],
    platform_allowlist: [...input.platformAllowlist],
    channel_allowlist: [...input.channelAllowlist],
    created_by: input.createdBy,
  })

  if (error) return error.code === '23505' ? refuse('invalid_request', 409) : refuse('unavailable', 503)
  return { ok: true, credential }
}

export async function setServiceCallerStatus(
  callerId: string,
  status: 'enabled' | 'revoked',
  actor: string,
): Promise<{ ok: true } | MachineRefusal> {
  const client = getSecretClient()
  if (!client) return refuse('not_configured', 503)
  const now = new Date().toISOString()
  const { error } = await client
    .from('rein_service_callers')
    .update(
      status === 'revoked'
        ? { status, revoked_at: now, revoked_by: actor, updated_at: now }
        : { status, revoked_at: null, revoked_by: null, updated_at: now },
    )
    .eq('caller_id', callerId)
  if (error) return refuse('unavailable', 503)
  return { ok: true }
}
