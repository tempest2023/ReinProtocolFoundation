import { z } from 'zod'
import { proofSchema, refuse, type MachineRefusal } from '@/lib/agent/contracts'
import { touchCaller } from '@/lib/agent/service-callers'
import { getSecretClient } from '@/lib/supabase/secret'
import { BINDING_VALIDITY } from '@/lib/identity/linking'
import { hashValue } from '@/lib/agent/credentials'
import { authorizeAssertion, failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/identity/link/complete
 *
 * Finish a binding once the person has typed the short-lived code their browser
 * showed them back into the chat platform. The request carries the code and the
 * agent's proof and nothing else: the session is inferred on the server from the
 * code digest, and the guarded database function re-validates the session's
 * tuple against the proof tuple inside its own transaction.
 */

const completeRequestSchema = z
  .object({
    binding_code: z.string().trim().min(1).max(128),
    proof: proofSchema,
  })
  .strict()

interface SessionByBindingCodeRow {
  session_token_hash: string
  platform: string
  platform_workspace_id: string
  platform_user_id: string
  state: string
}

function completeRefusal(reason: string): MachineRefusal {
  switch (reason) {
    case 'binding_code_invalid':
      return refuse('binding_code_invalid', 403)
    case 'binding_expired':
      return refuse('binding_expired', 410)
    case 'binding_not_verified':
    case 'binding_tuple_mismatch':
      return refuse('binding_not_verified', 403)
    case 'identity_revoked':
      return refuse('identity_revoked', 403)
    case 'contact_conflict':
      return refuse('contact_conflict', 409)
    case 'binding_already_completed':
    case 'binding_state_invalid':
      return refuse('invalid_request', 409)
    case 'binding_not_found':
      return refuse('binding_code_invalid', 403)
    default:
      return refuse('unavailable', 503)
  }
}

export async function POST(request: Request) {
  const parsed = completeRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const authorized = await authorizeAssertion(request, 'identity.link.complete', parsed.data.proof)
  if (!authorized.ok) return failure(authorized)
  const { caller, assertion } = authorized.value

  const client = getSecretClient()
  if (!client) return failure(refuse('not_configured', 503))

  const bindingCodeHash = hashValue(parsed.data.binding_code)
  const { data: session, error } = await client
    .from('rein_link_sessions')
    .select('session_token_hash,platform,platform_workspace_id,platform_user_id,state')
    .eq('binding_code_hash', bindingCodeHash)
    .maybeSingle<SessionByBindingCodeRow>()

  if (error) return failure(refuse('unavailable', 503))
  if (!session) return failure(refuse('binding_code_invalid', 403))

  if (
    session.platform !== assertion.platform ||
    session.platform_workspace_id !== assertion.workspaceId ||
    session.platform_user_id !== assertion.platformUserId
  ) {
    return failure(refuse('binding_not_verified', 403))
  }

  const { data, error: rpcError } = await client.rpc('rein_complete_platform_link', {
    p_session_token_hash: session.session_token_hash,
    p_binding_code_hash: bindingCodeHash,
    p_validity: BINDING_VALIDITY,
    p_platform: assertion.platform,
    p_workspace_id: assertion.workspaceId,
    p_platform_user_id: assertion.platformUserId,
    p_actor_type: 'agent',
  })
  if (rpcError) return failure(refuse('unavailable', 503))

  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row || row.ok !== true) {
    return failure(completeRefusal(typeof row?.reason === 'string' ? row.reason : 'unavailable'))
  }

  await touchCaller(caller.callerId)
  return noStore({
    ok: true,
    link_id: typeof row.link_id === 'string' ? row.link_id : null,
    contact_id: typeof row.contact_id === 'string' ? row.contact_id : null,
    platform: String(row.platform ?? assertion.platform),
    workspace_id: String(row.platform_workspace_id ?? assertion.workspaceId),
    platform_user_id: String(row.platform_user_id ?? assertion.platformUserId),
  })
}
