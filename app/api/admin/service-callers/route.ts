import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { registerServiceCaller } from '@/lib/agent/service-callers'
import {
  SERVICE_SCOPES,
  channelAllowlistSchema,
  isServiceScope,
  platformAllowlistSchema,
  refuse,
} from '@/lib/agent/contracts'
import { failure, noStore, readJsonBody } from '@/app/api/identity/_http'

export const runtime = 'nodejs'

/**
 * POST /api/admin/service-callers
 *
 * Register one machine principal and return its credential exactly once. Only an
 * authenticated administrator may call this; the caller row carries scopes and
 * allowlists, never a human role.
 */

const CALLER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const provisionRequestSchema = z
  .object({
    caller_id: z.string().trim().regex(CALLER_ID_PATTERN),
    label: z.string().trim().min(1).max(128),
    scopes: z.array(z.string().trim().min(1).max(64)).min(1).max(SERVICE_SCOPES.length),
    platform_allowlist: platformAllowlistSchema,
    channel_allowlist: channelAllowlistSchema,
  })
  .strict()

export async function POST(request: Request) {
  const { user } = await requireAdmin()

  const parsed = provisionRequestSchema.safeParse(await readJsonBody(request))
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const { caller_id, label, scopes, platform_allowlist, channel_allowlist } = parsed.data
  if (!scopes.every(isServiceScope)) return failure(refuse('invalid_request', 400))

  const result = await registerServiceCaller({
    callerId: caller_id,
    label,
    scopes: [...new Set(scopes)],
    platformAllowlist: platform_allowlist,
    channelAllowlist: channel_allowlist,
    createdBy: user.email ?? user.id,
  })
  if (!result.ok) return failure(result)

  return noStore({ ok: true, caller_id, credential: result.credential })
}
