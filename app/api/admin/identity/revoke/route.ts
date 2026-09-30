import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { revokePlatformLink } from '@/lib/identity/linking'
import { refuse } from '@/lib/agent/contracts'
import { failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/admin/identity/revoke
 *
 * Revoke one platform binding. The row is kept as a tombstone, so the same
 * platform account cannot silently re-bind after a revocation. Only an
 * authenticated administrator may call this, and a reason is required.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const revokeRequestSchema = z
  .object({
    link_id: z.string().trim().regex(UUID_PATTERN),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()

export async function POST(request: Request) {
  const { user } = await requireAdmin()

  const parsed = revokeRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const result = await revokePlatformLink({
    linkId: parsed.data.link_id,
    actor: user.email ?? user.id,
    reason: parsed.data.reason,
    actorType: 'admin',
  })
  if (!result.ok) {
    if (result.reason === 'not_configured') return failure(refuse('not_configured', 503))
    if (result.reason === 'link_not_found') return failure(refuse('invalid_request', 404))
    if (result.reason === 'reason_required') return failure(refuse('invalid_request', 400))
    return failure(refuse('unavailable', 503))
  }

  return noStore({
    ok: true,
    link_id: parsed.data.link_id,
    reason: result.reason,
    contact_id: result.contactId,
  })
}
