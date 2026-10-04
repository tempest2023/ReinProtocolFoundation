import { z } from 'zod'

/**
 * The machine-facing contract for registered service callers.
 *
 * Every operation is listed here by name with the one scope it requires. A
 * request names an operation, and the server looks it up in this table; it never
 * reaches a method through a caller-supplied property path, so an unknown or
 * misspelled operation is refused instead of executed.
 */

export const GOVERNANCE_SCOPES = [
  'governance.read',
  'governance.propose',
  'governance.poll.open',
  'governance.poll.vote',
  'governance.poll.finalize',
  'governance.revision.comment',
  'governance.revision.approve',
  'governance.revision.apply',
] as const

export const IDENTITY_SCOPES = [
  'identity.resolve',
  'identity.link.create',
  'identity.link.status',
  'identity.link.complete',
  'identity.link.revoke',
  'ingress.relay',
] as const

export const SERVICE_SCOPES = [...GOVERNANCE_SCOPES, ...IDENTITY_SCOPES] as const

export type ServiceScope = (typeof SERVICE_SCOPES)[number]

const scopeSet: ReadonlySet<string> = new Set(SERVICE_SCOPES)

export function isServiceScope(value: unknown): value is ServiceScope {
  return typeof value === 'string' && scopeSet.has(value)
}

/** Operations dispatched by `POST /api/agent/operations`, each with its scope. */
export const GOVERNANCE_OPERATION_SCOPES = {
  member_status: 'governance.read',
  available_funds: 'governance.read',
  get_poll: 'governance.read',
  get_proposal: 'governance.read',
  list_ballots: 'governance.read',
  get_vote_type: 'governance.read',
  list_vote_types: 'governance.read',
  list_candidate_proposals: 'governance.read',
  get_revision: 'governance.read',
  submit_proposal: 'governance.propose',
  create_poll: 'governance.poll.open',
  cast_ballot: 'governance.poll.vote',
  finalize_poll: 'governance.poll.finalize',
  record_proposal_revision: 'governance.revision.comment',
  approve_proposal_revision: 'governance.revision.approve',
  apply_proposal_revision: 'governance.revision.apply',
} as const satisfies Record<string, ServiceScope>

export type GovernanceOperation = keyof typeof GOVERNANCE_OPERATION_SCOPES

const governanceOperationSet: ReadonlySet<string> = new Set(Object.keys(GOVERNANCE_OPERATION_SCOPES))

export function isGovernanceOperation(value: unknown): value is GovernanceOperation {
  return typeof value === 'string' && governanceOperationSet.has(value)
}

export function scopeForOperation(operation: GovernanceOperation): ServiceScope {
  return GOVERNANCE_OPERATION_SCOPES[operation]
}

/** A platform tuple a caller is allowed to act for. */
/** A platform entry the caller may act for, or an explicit `*` workspace wildcard. */
export const platformAllowlistEntrySchema = z
  .object({
    platform: z.enum(['slack', 'discord']),
    workspace_id: z.string().trim().min(1).max(128),
  })
  .strict()

export type PlatformAllowlistEntry = z.infer<typeof platformAllowlistEntrySchema>

export const platformAllowlistSchema = z.array(platformAllowlistEntrySchema).max(64)
export const channelAllowlistSchema = z.array(z.string().trim().min(1).max(128)).max(512)

/**
 * An allowlist is a positive list only. An empty or unparsable list authorizes
 * nothing, so a malformed stored value fails closed instead of silently
 * becoming "allow every workspace". A caller that must serve every workspace
 * says so explicitly with a `*` workspace entry, which is a deliberate,
 * registered decision rather than a parsing accident.
 */
export function allowsPlatform(
  allowlist: readonly PlatformAllowlistEntry[],
  platform: string,
  workspaceId: string,
): boolean {
  if (allowlist.length === 0) return false
  return allowlist.some(
    (entry) => entry.platform === platform && (entry.workspace_id === '*' || entry.workspace_id === workspaceId),
  )
}

export function allowsChannel(allowlist: readonly string[], channelId: string): boolean {
  if (allowlist.length === 0) return false
  return allowlist.includes('*') || allowlist.includes(channelId)
}

/**
 * Human provenance supplied with one machine request.
 *
 * Only an ingress assertion is accepted. A machine credential is never a body
 * field and never stands for a person: it travels in the request headers
 * (`X-Rein-Caller-Id` plus the bearer secret), where the transport handler reads
 * it, and it establishes only that a registered service is calling. The person
 * behind the request is proven by the assertion, which the backend mints from a
 * platform event it verified itself.
 */
export const assertionProofSchema = z
  .object({
    kind: z.literal('assertion'),
    assertion: z.string().min(1).max(512),
  })
  .strict()

export const proofSchema = assertionProofSchema

export type Proof = z.infer<typeof proofSchema>

export const operationsRequestSchema = z
  .object({
    operation: z.string().trim().min(1).max(64),
    input: z.unknown().optional(),
    proof: proofSchema,
  })
  .strict()

/** The machine-credential header names. The secret never appears in a body. */
export const CALLER_ID_HEADER = 'x-rein-caller-id'
export const CALLER_SECRET_HEADER = 'authorization'

/** Closed reason codes returned to a machine caller. Never provider text. */
export const CALLER_REASONS = [
  'caller_unknown',
  'caller_disabled',
  'caller_revoked',
  'bad_credential',
  'scope_missing',
  'platform_not_allowed',
  'channel_not_allowed',
  'proof_expired',
  'proof_unknown',
  'proof_consumed',
  'event_already_asserted',
  'invalid_request',
  'invalid_operation',
  'not_configured',
  'ineligible_actor',
  'contact_ambiguous',
  'contact_conflict',
  'contact_not_registered',
  'identity_revoked',
  'binding_not_verified',
  'binding_code_invalid',
  'binding_expired',
  'unavailable',
] as const

export type CallerReason = (typeof CALLER_REASONS)[number]

export interface MachineRefusal {
  ok: false
  reason: CallerReason
  httpStatus: number
}

export function refuse(reason: CallerReason, httpStatus: number): MachineRefusal {
  return { ok: false, reason, httpStatus }
}
