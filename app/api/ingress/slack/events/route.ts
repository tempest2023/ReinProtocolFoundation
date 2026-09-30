import { allowsChannel, allowsPlatform, refuse } from '@/lib/agent/contracts'
import { touchCaller } from '@/lib/agent/service-callers'
import { mintIngressAssertion, verifySlackSignature } from '@/lib/agent/assertions'
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
 * POST /api/ingress/slack/events
 *
 * The signed Slack ingress. The raw request body is verified against Slack's
 * signing secret with the five-minute replay window before a single byte of
 * content is trusted, and only then is a payload parsed. Slack's one-time
 * url_verification handshake is answered with the challenge.
 *
 * Slack cannot send our service headers, so a real delivery is resolved in
 * DIRECT mode: the enrolled service principal is named by the server-owned
 * `REIN_SLACK_HTTP_CALLER_ID` environment variable and loaded without a
 * credential, because the verified signature is the authentication. A delivery
 * that does carry the service headers (an API proxy) is resolved in FORWARDED
 * mode instead, and a present-but-invalid credential is refused rather than
 * falling back. Either way the caller's scopes, status, platform/workspace and
 * channel allowlists are enforced against the tuple the signature vouches for,
 * and the relayed body is never authority for a user id.
 *
 * Success is a provider-native acknowledgement: 200 with the challenge for the
 * handshake, or 200 with a small receipt for an event. The verified event
 * receipt is stored as the short-lived assertion row; this endpoint is not the
 * Agent bridge. The enrolled relay endpoint carries Agent traffic.
 */

const SIGNING_SECRET_ENV = 'REIN_SLACK_SIGNING_SECRET'
const HTTP_CALLER_ENV = 'REIN_SLACK_HTTP_CALLER_ID'

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

function deriveSlackTuple(payload: Record<string, unknown>): DerivedTuple | null {
  const event = asRecord(payload.event)
  const item = asRecord(event.item)
  const workspaceId = text(payload.team_id)
  const platformUserId = text(event.user) || text(event.user_id)
  const channelId = text(event.channel) || text(item.channel)
  const eventId = text(payload.event_id)
  if (![workspaceId, platformUserId, channelId, eventId].every(bounded)) return null
  return { platform: 'slack', workspaceId, platformUserId, channelId, eventId }
}

export async function POST(request: Request) {
  const rawBody = await readRawBody(request)
  if (rawBody === null) return failure(refuse('invalid_request', 400))

  const signingSecret = process.env[SIGNING_SECRET_ENV]?.trim()
  if (!signingSecret) return failure(refuse('not_configured', 503))

  const signatureValid = verifySlackSignature({
    signingSecret,
    timestamp: request.headers.get('x-slack-request-timestamp'),
    rawBody,
    signature: request.headers.get('x-slack-signature'),
  })
  if (!signatureValid) return failure(refuse('bad_credential', 401))

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody) as unknown
  } catch {
    return failure(refuse('invalid_request', 400))
  }
  const payload = asRecord(parsedBody)

  // Slack's endpoint handshake. It carries no event and grants nothing, so it is
  // answered once the signature above has been verified.
  if (payload.type === 'url_verification') {
    const challenge = text(payload.challenge)
    if (!bounded(challenge)) return failure(refuse('invalid_request', 400))
    return noStore({ challenge })
  }

  if (payload.type !== 'event_callback') return failure(refuse('invalid_request', 400))

  const tuple = deriveSlackTuple(payload)
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

  // A forwarding proxy consumes the proof; Slack itself ignores the body and
  // only needs the 200, so it gets a receipt without a Rein-shaped proof.
  if (mode === 'forwarded') {
    return noStore({ ok: true, assertion: minted.assertion, expires_at: minted.expiresAt })
  }
  return noStore({ ok: true, expires_at: minted.expiresAt })
}
