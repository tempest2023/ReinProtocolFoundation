import { allowsChannel, allowsPlatform, refuse } from '@/lib/agent/contracts'
import { touchCaller } from '@/lib/agent/service-callers'
import { mintIngressAssertion, verifyDiscordSignature } from '@/lib/agent/assertions'
import { hashValue } from '@/lib/agent/credentials'
import {
  asRecord,
  failure,
  noStore,
  readRawBody,
  resolveSignedTransportCaller,
  text,
} from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/ingress/discord/interactions
 *
 * The signed Discord ingress. The raw body is verified against Discord's Ed25519
 * public key with the five-minute replay window before any content is trusted.
 * Discord's PING handshake is answered with a type 1 response.
 *
 * Discord cannot send our service headers, so a real interaction is resolved in
 * DIRECT mode: the enrolled service principal is named by the server-owned
 * `REIN_DISCORD_HTTP_CALLER_ID` environment variable and loaded without a
 * credential, because the verified signature is the authentication. A delivery
 * that does carry the service headers (an API proxy) is resolved in FORWARDED
 * mode instead, and a present-but-invalid credential is refused rather than
 * falling back. Either way the caller's scopes, status, guild and channel
 * allowlists are enforced against the tuple the signature vouches for.
 *
 * Success is a provider-native acknowledgement. In direct mode an interaction
 * gets a valid deferred response (`type: 5`) that claims no Agent answer; the
 * verified event receipt is stored as the short-lived assertion row. The
 * enrolled relay endpoint carries Agent traffic, not this one.
 */

const PUBLIC_KEY_ENV = 'REIN_DISCORD_PUBLIC_KEY'
const HTTP_CALLER_ENV = 'REIN_DISCORD_HTTP_CALLER_ID'

interface DerivedTuple {
  platform: 'slack' | 'discord'
  workspaceId: string
  platformUserId: string
  channelId: string
  eventId: string
}

function bounded(value: string): boolean {
  return value.length > 0 && value.length <= 256
}

function deriveDiscordTuple(payload: Record<string, unknown>): DerivedTuple | null {
  const member = asRecord(payload.member)
  const memberUser = asRecord(member.user)
  const user = asRecord(payload.user)
  const workspaceId = text(payload.guild_id)
  const platformUserId = text(memberUser.id) || text(user.id)
  const channelId = text(payload.channel_id)
  const eventId = text(payload.id)
  if (![workspaceId, platformUserId, channelId, eventId].every(bounded)) return null
  return { platform: 'discord', workspaceId, platformUserId, channelId, eventId }
}

export async function POST(request: Request) {
  const rawBody = await readRawBody(request)
  if (rawBody === null) return failure(refuse('invalid_request', 400))

  const publicKeyHex = process.env[PUBLIC_KEY_ENV]?.trim()
  if (!publicKeyHex) return failure(refuse('not_configured', 503))

  const signatureValid = verifyDiscordSignature({
    publicKeyHex,
    timestamp: request.headers.get('x-signature-timestamp'),
    rawBody,
    signatureHex: request.headers.get('x-signature-ed25519'),
  })
  if (!signatureValid) return failure(refuse('bad_credential', 401))

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody) as unknown
  } catch {
    return failure(refuse('invalid_request', 400))
  }
  const payload = asRecord(parsedBody)

  // Discord's PING handshake. It carries no interaction and grants nothing, so it
  // is answered once the signature above has been verified.
  if (payload.type === 1) {
    return noStore({ type: 1 })
  }

  const tuple = deriveDiscordTuple(payload)
  if (!tuple) return failure(refuse('invalid_request', 400))

  const resolved = await resolveSignedTransportCaller(request, process.env[HTTP_CALLER_ENV])
  if (!resolved.ok) return failure(resolved)
  const { caller, mode } = resolved.value

  if (!allowsPlatform(caller.platformAllowlist, tuple.platform, tuple.workspaceId)) {
    return failure(refuse('platform_not_allowed', 403))
  }
  if (!allowsChannel(caller.channelAllowlist, tuple.channelId)) {
    return failure(refuse('channel_not_allowed', 403))
  }

  const minted = await mintIngressAssertion({
    callerId: caller.callerId,
    platform: tuple.platform,
    workspaceId: tuple.workspaceId,
    platformUserId: tuple.platformUserId,
    channelId: tuple.channelId,
    eventId: tuple.eventId,
    source: 'http_signature',
    payloadDigest: hashValue(rawBody),
  })
  if (!minted.ok) return failure(minted)

  await touchCaller(caller.callerId)

  // A forwarding proxy consumes the proof; Discord must receive a valid
  // interaction callback, so it gets a deferred acknowledgement that claims
  // nothing about an Agent answer.
  if (mode === 'forwarded') {
    return noStore({ ok: true, assertion: minted.assertion, expires_at: minted.expiresAt })
  }
  return noStore({ type: 5 })
}
