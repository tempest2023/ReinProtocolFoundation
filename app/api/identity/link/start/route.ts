import { z } from 'zod'
import { proofSchema, refuse } from '@/lib/agent/contracts'
import { touchCaller } from '@/lib/agent/service-callers'
import { issueLinkSession } from '@/lib/identity/linking'
import { publicEnv } from '@/lib/env'
import { authorizeAssertion, failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/identity/link/start
 *
 * Open one binding session for the platform tuple a verified event produced and
 * hand back the website URL the person opens to prove control of their address.
 * The session token is opaque; it opens the page but completes nothing on its
 * own, and the raw value is never stored, only its digest.
 */

const startRequestSchema = z.object({ proof: proofSchema }).strict()

export async function POST(request: Request) {
  const parsed = startRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const authorized = await authorizeAssertion(request, 'identity.link.create', parsed.data.proof)
  if (!authorized.ok) return failure(authorized)
  const { caller, assertion } = authorized.value

  const issued = await issueLinkSession(
    {
      platform: assertion.platform,
      workspaceId: assertion.workspaceId,
      platformUserId: assertion.platformUserId,
      channelId: assertion.channelId,
    },
    caller.callerId,
  )
  if (!issued.ok) {
    return failure(issued.reason === 'not_configured' ? refuse('not_configured', 503) : refuse('unavailable', 503))
  }

  await touchCaller(caller.callerId)
  const verificationUrl = `${publicEnv.siteUrl}/community/link/${encodeURIComponent(issued.session.sessionToken)}`
  return noStore({
    ok: true,
    session_id: issued.session.sessionToken,
    verification_url: verificationUrl,
    expires_at: issued.session.expiresAt,
  })
}
