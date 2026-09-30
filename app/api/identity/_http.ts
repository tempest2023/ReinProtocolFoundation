import { NextResponse } from 'next/server'
import {
  CALLER_ID_HEADER,
  CALLER_SECRET_HEADER,
  allowsChannel,
  allowsPlatform,
  channelAllowlistSchema,
  isServiceScope,
  platformAllowlistSchema,
  refuse,
  type MachineRefusal,
  type Proof,
  type ServiceScope,
} from '@/lib/agent/contracts'
import { validateIngressAssertion, type ValidatedAssertion } from '@/lib/agent/assertions'
import { authenticateCaller, type AuthenticatedCaller } from '@/lib/agent/service-callers'
import { getSecretClient } from '@/lib/supabase/secret'

/**
 * Shared boundary helpers for the machine-facing route handlers that sit beside
 * the identity-linking and ingress contract (the identity, ingress and admin
 * routes). They are colocated here as one private module instead of being copied
 * per route.
 *
 * Every response is `no-store`, every refusal is one of the closed reason codes
 * in `lib/agent/contracts.ts`, and nothing here echoes provider text, a raw
 * credential, an address or a raw database message.
 */

export const MAX_JSON_BODY_CHARS = 64 * 1024
export const MAX_RAW_BODY_CHARS = 256 * 1024

export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export function failure(refusal: MachineRefusal): NextResponse {
  return noStore({ ok: false, reason: refusal.reason }, refusal.httpStatus)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function readBoundedBody(request: Request, maxChars: number): Promise<string | null> {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return null
  }
  if (raw.length === 0 || raw.length > maxChars) return null
  return raw
}

/** Read a JSON body, bounded by length. Returns undefined for anything unusable. */
export async function readJsonBody(request: Request, maxChars = MAX_JSON_BODY_CHARS): Promise<unknown> {
  const raw = await readBoundedBody(request, maxChars)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/** Read a raw body for signature verification, bounded by length. */
export async function readRawBody(request: Request, maxChars = MAX_RAW_BODY_CHARS): Promise<string | null> {
  return readBoundedBody(request, maxChars)
}

export interface AuthorizedAssertion {
  caller: AuthenticatedCaller
  assertion: ValidatedAssertion
}

/**
 * Authenticate one machine caller, validate the ingress assertion it presents,
 * and enforce the caller match plus the platform and channel allowlists. The
 * proof proves a platform event; it never stands in for the machine credential.
 */
export async function authorizeAssertion(
  request: Request,
  scope: ServiceScope,
  proof: Proof,
): Promise<{ ok: true; value: AuthorizedAssertion } | MachineRefusal> {
  const auth = await authenticateCaller(request, { scope })
  if (!auth.ok) return auth

  const validated = await validateIngressAssertion(proof.assertion)
  if (!validated.ok) return validated

  const { assertion } = validated
  if (assertion.callerId !== auth.caller.callerId) return refuse('caller_unknown', 403)
  if (!allowsPlatform(auth.caller.platformAllowlist, assertion.platform, assertion.workspaceId)) {
    return refuse('platform_not_allowed', 403)
  }
  if (!allowsChannel(auth.caller.channelAllowlist, assertion.channelId)) {
    return refuse('channel_not_allowed', 403)
  }

  return { ok: true, value: { caller: auth.caller, assertion } }
}

interface RegisteredCallerRow {
  caller_id: string
  label: string
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

/**
 * Read one registered caller by id with no credential check.
 *
 * This is only for a transport that has authenticated the delivery by other
 * means — a verified platform signature, or the caller-forwarded service
 * headers. It still refuses an unknown, revoked or disabled caller and still
 * returns the caller's own scopes and allowlists, so nothing downstream can be
 * widened by skipping the credential.
 */
export async function loadRegisteredCaller(
  callerId: string,
): Promise<{ ok: true; caller: AuthenticatedCaller } | MachineRefusal> {
  const client = getSecretClient()
  if (!client) return refuse('not_configured', 503)

  const { data, error } = await client
    .from('rein_service_callers')
    .select('caller_id,label,scopes,platform_allowlist,channel_allowlist,status')
    .eq('caller_id', callerId)
    .maybeSingle<RegisteredCallerRow>()

  if (error) return refuse('unavailable', 503)
  if (!data) return refuse('caller_unknown', 401)
  if (data.status === 'revoked') return refuse('caller_revoked', 403)
  if (data.status !== 'enabled') return refuse('caller_disabled', 403)

  const platformParsed = platformAllowlistSchema.safeParse(parseJsonArray(data.platform_allowlist))
  const channelParsed = channelAllowlistSchema.safeParse(
    parseJsonArray(data.channel_allowlist).filter((entry): entry is string => typeof entry === 'string'),
  )

  return {
    ok: true,
    caller: {
      callerId: data.caller_id,
      label: data.label,
      scopes: (data.scopes ?? []).filter(isServiceScope),
      platformAllowlist: platformParsed.success ? platformParsed.data : [],
      channelAllowlist: channelParsed.success ? channelParsed.data : [],
    },
  }
}

export interface SignedTransportCaller {
  caller: AuthenticatedCaller
  mode: 'forwarded' | 'direct'
}

/**
 * Choose the enrolled service principal for a signature-verified provider
 * delivery.
 *
 * A platform webhook cannot carry our service headers, so in direct mode the
 * caller is named by a server-owned environment variable and looked up with no
 * credential: the verified platform signature is the authentication. When the
 * request does carry the service headers (an API proxy forwarding a delivery),
 * those are honoured strictly instead — a present-but-invalid forwarded
 * credential is refused rather than silently downgraded to direct mode.
 */
export async function resolveSignedTransportCaller(
  request: Request,
  envCallerId: string | undefined,
): Promise<{ ok: true; value: SignedTransportCaller } | MachineRefusal> {
  const forwarded = request.headers.has(CALLER_ID_HEADER) || request.headers.has(CALLER_SECRET_HEADER)
  if (forwarded) {
    const auth = await authenticateCaller(request, { scope: 'ingress.relay' })
    if (!auth.ok) return auth
    return { ok: true, value: { caller: auth.caller, mode: 'forwarded' } }
  }

  const callerId = envCallerId?.trim()
  if (!callerId) return refuse('not_configured', 503)

  const loaded = await loadRegisteredCaller(callerId)
  if (!loaded.ok) return loaded
  if (!loaded.caller.scopes.includes('ingress.relay')) return refuse('scope_missing', 403)

  return { ok: true, value: { caller: loaded.caller, mode: 'direct' } }
}

/** Accept epoch seconds, epoch milliseconds or an ISO-8601 instant. */
export function parseEventTimestamp(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed)
    if (!Number.isFinite(numeric)) return null
    return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric)
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

export function withinSkew(
  eventSeconds: number,
  skewSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return Math.abs(nowSeconds - eventSeconds) <= skewSeconds
}
