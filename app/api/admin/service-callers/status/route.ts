import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { setServiceCallerStatus } from '@/lib/agent/service-callers'
import { getSecretClient } from '@/lib/supabase/secret'
import { refuse } from '@/lib/agent/contracts'
import { failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/admin/service-callers/status
 *
 * Enable or revoke one registered machine principal. Revocation is the normal
 * way to end a caller; the row is kept so the identifier cannot be reused
 * silently, and only an authenticated administrator may change its status.
 */

const CALLER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const statusRequestSchema = z
  .object({
    caller_id: z.string().trim().regex(CALLER_ID_PATTERN),
    status: z.enum(['enabled', 'revoked']),
  })
  .strict()

export async function POST(request: Request) {
  const { user } = await requireAdmin()

  const parsed = statusRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const client = getSecretClient()
  if (!client) return failure(refuse('not_configured', 503))

  const { data, error } = await client
    .from('rein_service_callers')
    .select('caller_id')
    .eq('caller_id', parsed.data.caller_id)
    .maybeSingle<{ caller_id: string }>()

  if (error) return failure(refuse('unavailable', 503))
  if (!data) return failure(refuse('invalid_request', 404))

  const result = await setServiceCallerStatus(parsed.data.caller_id, parsed.data.status, user.email ?? user.id)
  if (!result.ok) return failure(result)

  return noStore({ ok: true, caller_id: parsed.data.caller_id, status: parsed.data.status })
}
