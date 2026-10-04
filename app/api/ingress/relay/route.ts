import { z } from 'zod'
import { allowsChannel, allowsPlatform, refuse } from '@/lib/agent/contracts'
import { authenticateCaller, touchCaller } from '@/lib/agent/service-callers'
import { INGRESS_SKEW_SECONDS, mintIngressAssertion } from '@/lib/agent/assertions'
import { hashValue } from '@/lib/agent/credentials'
import { failure, noStore, parseEventTimestamp, readJsonBody, withinSkew } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/ingress/relay
 *
 * The enrolled-relay transport. A relay that carries Socket Mode or Gateway
 * traffic has no per-message platform signature, so the caller must be a
 * registered machine principal holding the `ingress.relay` scope, and the tuple
 * it relays is bound to that caller's platform and channel allowlists before any
 * proof is minted. The result is a short-lived opaque assertion, reusable until
 * it expires, which the agent presents as its proof elsewhere.
 */

const relayRequestSchema = z
  .object({
    platform: z.enum(['slack', 'discord']),
    workspace_id: z.string().trim().min(1).max(128),
    platform_user_id: z.string().trim().min(1).max(128),
    channel_id: z.string().trim().min(1).max(128),
    event_id: z.string().trim().min(1).max(256),
    event_ts: z.string().trim().min(1).max(64),
  })
  .strict()

export async function POST(request: Request) {
  const parsed = relayRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const { platform, workspace_id, platform_user_id, channel_id, event_id, event_ts } = parsed.data

  const auth = await authenticateCaller(request, { scope: 'ingress.relay' })
  if (!auth.ok) return failure(auth)
  if (!allowsPlatform(auth.caller.platformAllowlist, platform, workspace_id)) {
    return failure(refuse('platform_not_allowed', 403))
  }
  if (!allowsChannel(auth.caller.channelAllowlist, channel_id)) {
    return failure(refuse('channel_not_allowed', 403))
  }

  const eventSeconds = parseEventTimestamp(event_ts)
  if (eventSeconds === null || !withinSkew(eventSeconds, INGRESS_SKEW_SECONDS)) {
    return failure(refuse('invalid_request', 400))
  }

  const minted = await mintIngressAssertion({
    callerId: auth.caller.callerId,
    platform,
    workspaceId: workspace_id,
    platformUserId: platform_user_id,
    channelId: channel_id,
    eventId: event_id,
    source: 'relay',
    payloadDigest: hashValue(JSON.stringify([platform, workspace_id, platform_user_id, channel_id, event_id, event_ts])),
  })
  if (!minted.ok) return failure(minted)

  await touchCaller(auth.caller.callerId)
  return noStore({ ok: true, assertion: minted.assertion, expires_at: minted.expiresAt })
}
