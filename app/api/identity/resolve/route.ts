import { z } from 'zod'
import { proofSchema, refuse } from '@/lib/agent/contracts'
import { touchCaller } from '@/lib/agent/service-callers'
import { resolvePlatformIdentity } from '@/lib/identity/linking'
import { authorizeAssertion, failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/identity/resolve
 *
 * Resolve the platform tuple carried by a verified ingress assertion to the
 * canonical organizational contact, re-derived on this call from the binding
 * record. The assertion is the only accepted proof; the machine credential
 * travels in headers and proves only that a registered caller is asking.
 */

const resolveRequestSchema = z.object({ proof: proofSchema }).strict()

export async function POST(request: Request) {
  const parsed = resolveRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const authorized = await authorizeAssertion(request, 'identity.resolve', parsed.data.proof)
  if (!authorized.ok) return failure(authorized)
  const { caller, assertion } = authorized.value

  const identity = await resolvePlatformIdentity({
    platform: assertion.platform,
    workspaceId: assertion.workspaceId,
    platformUserId: assertion.platformUserId,
  })
  if (!identity) return failure(refuse('unavailable', 503))

  await touchCaller(caller.callerId)
  return noStore({
    ok: true,
    status: identity.status,
    contact_id: identity.contactId,
    is_active_contributor: identity.isActiveContributor,
    is_director: identity.isDirector,
  })
}
