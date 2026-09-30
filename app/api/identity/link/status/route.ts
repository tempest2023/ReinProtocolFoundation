import { z } from 'zod'
import { proofSchema, refuse } from '@/lib/agent/contracts'
import { touchCaller } from '@/lib/agent/service-callers'
import { lookupLinkSession } from '@/lib/identity/linking'
import { authorizeAssertion, failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/identity/link/status
 *
 * Report the state of one binding session to the agent that opened it. The
 * session is only readable with an assertion for the same platform tuple, so a
 * leaked session id is not enough to observe someone else's progress. No email
 * value, digest or binding code is ever returned.
 */

const statusRequestSchema = z
  .object({
    session_id: z.string().trim().min(1).max(256),
    proof: proofSchema,
  })
  .strict()

export async function POST(request: Request) {
  const parsed = statusRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const authorized = await authorizeAssertion(request, 'identity.link.status', parsed.data.proof)
  if (!authorized.ok) return failure(authorized)
  const { caller, assertion } = authorized.value

  const session = await lookupLinkSession(parsed.data.session_id)
  if (!session) return failure(refuse('invalid_request', 404))

  if (
    session.platform !== assertion.platform ||
    session.workspaceId !== assertion.workspaceId ||
    session.platformUserId !== assertion.platformUserId
  ) {
    return failure(refuse('binding_not_verified', 403))
  }
  if (session.state === 'expired' || new Date(session.expiresAt).getTime() <= Date.now()) {
    return failure(refuse('binding_expired', 410))
  }

  await touchCaller(caller.callerId)
  return noStore({
    ok: true,
    state: session.state,
    linked: session.state === 'completed',
    contact_id: session.state === 'completed' ? session.contactId : null,
    expires_at: session.expiresAt,
  })
}
