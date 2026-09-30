import { NextResponse } from 'next/server'
import { createFoundationDbReader } from '@/lib/agent/governance/reader'
import { createFoundationDbWriter } from '@/lib/agent/governance/writer'
import { hashValue } from '@/lib/agent/credentials'
import { authenticateCaller, touchCaller } from '@/lib/agent/service-callers'
import { validateIngressAssertion } from '@/lib/agent/assertions'
import {
  allowsChannel,
  allowsPlatform,
  isGovernanceOperation,
  operationsRequestSchema,
  refuse,
  scopeForOperation,
  type GovernanceOperation,
  type MachineRefusal,
} from '@/lib/agent/contracts'
import { canApplyRevision, resolvePlatformIdentity } from '@/lib/identity/linking'

export const runtime = 'nodejs'

const WRITES: ReadonlySet<GovernanceOperation> = new Set([
  'submit_proposal',
  'create_poll',
  'cast_ballot',
  'finalize_poll',
  'record_proposal_revision',
  'approve_proposal_revision',
  'apply_proposal_revision',
])

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const optionalText = (value: unknown): string | null => {
  const candidate = text(value)
  return candidate.length > 0 ? candidate : null
}
const optionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const optionalList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

function failure(refusal: MachineRefusal) {
  return NextResponse.json({ ok: false, reason: refusal.reason }, { status: refusal.httpStatus })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return failure(refuse('invalid_request', 400))
  }

  const parsed = operationsRequestSchema.safeParse(body)
  if (!parsed.success) return failure(refuse('invalid_request', 400))

  const { operation, input, proof } = parsed.data
  if (!isGovernanceOperation(operation)) return failure(refuse('invalid_operation', 400))

  const auth = await authenticateCaller(request, { scope: scopeForOperation(operation) })
  if (!auth.ok) return failure(auth)

  const validated = await validateIngressAssertion(proof.assertion)
  if (!validated.ok) return failure(validated)
  if (validated.assertion.callerId !== auth.caller.callerId) {
    return failure(refuse('caller_unknown', 403))
  }
  if (!allowsPlatform(auth.caller.platformAllowlist, validated.assertion.platform, validated.assertion.workspaceId)) {
    return failure(refuse('platform_not_allowed', 403))
  }
  if (!allowsChannel(auth.caller.channelAllowlist, validated.assertion.channelId)) {
    return failure(refuse('channel_not_allowed', 403))
  }

  const identity = await resolvePlatformIdentity({
    platform: validated.assertion.platform,
    workspaceId: validated.assertion.workspaceId,
    platformUserId: validated.assertion.platformUserId,
  })
  if (!identity) return failure(refuse('unavailable', 503))
  if (identity.status === 'identity_revoked') return failure(refuse('identity_revoked', 403))
  if (identity.status !== 'resolved' || !identity.contactId) {
    return failure(refuse('binding_not_verified', 403))
  }
  const contactId = identity.contactId

  const reader = createFoundationDbReader({})
  // Every write this route performs is guarded: the guard is the authenticated caller and the digest
  // of the assertion the backend verified for this request. It is read from those verified values,
  // never from the request body, so a caller cannot name its own actor, caller or proof. The digest
  // is the only form of the assertion the database sees.
  const writer = createFoundationDbWriter({
    guard: { callerId: auth.caller.callerId, assertionHash: hashValue(proof.assertion) },
  })
  const payload = asRecord(input)

  if (operation === 'member_status') {
    const result = await reader.resolveMember({
      platform: validated.assertion.platform,
      workspaceId: validated.assertion.workspaceId,
      platformUserId: validated.assertion.platformUserId,
    })
    await touchCaller(auth.caller.callerId)
    return NextResponse.json({ ok: true, operation, result })
  }

  if (operation === 'available_funds') {
    const currency = text(payload.currency)
    if (!/^[A-Z]{3}$/.test(currency)) return failure(refuse('invalid_request', 400))
    const result = await reader.readAvailableFunds(currency)
    await touchCaller(auth.caller.callerId)
    return NextResponse.json({ ok: true, operation, result })
  }

  if (operation === 'submit_proposal' || operation === 'record_proposal_revision') {
    if (!identity.isActiveContributor) return failure(refuse('ineligible_actor', 403))
  }
  if (
    operation === 'create_poll' ||
    operation === 'cast_ballot' ||
    operation === 'finalize_poll' ||
    operation === 'approve_proposal_revision'
  ) {
    if (!identity.isDirector) return failure(refuse('ineligible_actor', 403))
  }
  if (operation === 'apply_proposal_revision') {
    const revisionId = text(payload.revisionId)
    if (!revisionId) return failure(refuse('invalid_request', 400))
    const revision = await writer.getRevision(revisionId)
    if (!revision.ok || !revision.revision) return failure(refuse('invalid_request', 404))
    if (!(await canApplyRevision(contactId, revision.revision.proposalId))) {
      return failure(refuse('ineligible_actor', 403))
    }
    const result = await writer.applyProposalRevision({ revisionId })
    await touchCaller(auth.caller.callerId)
    return NextResponse.json({ ok: true, operation, result })
  }

  if (!WRITES.has(operation)) {
    const result = await runRead(operation, payload, reader, writer)
    await touchCaller(auth.caller.callerId)
    return NextResponse.json({ ok: true, operation, result })
  }

  const result = await runWrite(operation, payload, contactId, writer)
  await touchCaller(auth.caller.callerId)
  return NextResponse.json({ ok: true, operation, result })
}

async function runRead(
  operation: GovernanceOperation,
  payload: Record<string, unknown>,
  reader: ReturnType<typeof createFoundationDbReader>,
  writer: ReturnType<typeof createFoundationDbWriter>,
) {
  switch (operation) {
    case 'get_poll':
      return writer.getPoll(text(payload.pollId))
    case 'get_proposal':
      return writer.getProposal(text(payload.proposalId))
    case 'list_ballots':
      return writer.listBallots(text(payload.pollId))
    case 'get_vote_type':
      return writer.getVoteType(text(payload.voteType))
    case 'list_vote_types':
      return writer.listVoteTypes({ limit: optionalNumber(payload.limit) })
    case 'list_candidate_proposals':
      return writer.listCandidateProposals({
        voteType: text(payload.voteType),
        limit: optionalNumber(payload.limit) ?? undefined,
        excludeProposalIds: optionalList(payload.excludeProposalIds),
        submittedSince: optionalText(payload.submittedSince) ?? undefined,
        includeRecentlyUnselected: payload.includeRecentlyUnselected === true,
      })
    case 'get_revision':
      return writer.getRevision(text(payload.revisionId))
    default:
      return reader.readAvailableFunds(text(payload.currency))
  }
}

async function runWrite(
  operation: GovernanceOperation,
  payload: Record<string, unknown>,
  contactId: string,
  writer: ReturnType<typeof createFoundationDbWriter>,
) {
  switch (operation) {
    case 'submit_proposal':
      return writer.submitProposal({
        id: text(payload.id),
        proposerContactId: contactId,
        title: text(payload.title),
        summary: optionalText(payload.summary),
        voteType: text(payload.voteType),
      })
    case 'create_poll':
      return writer.createPoll({
        id: text(payload.id),
        creatorContactId: contactId,
        title: text(payload.title),
        voteType: optionalText(payload.voteType) ?? undefined,
        candidateProposalIds: optionalList(payload.candidateProposalIds),
        opensAt: text(payload.opensAt),
        closesAt: text(payload.closesAt),
      })
    case 'cast_ballot':
      return writer.castBallot({
        pollId: text(payload.pollId),
        voterContactId: contactId,
        approvedProposalIds: optionalList(payload.approvedProposalIds),
      })
    case 'finalize_poll':
      return writer.finalizePoll({
        pollId: text(payload.pollId),
        actorContactId: contactId,
      })
    case 'approve_proposal_revision':
      return writer.approveProposalRevision({
        revisionId: text(payload.revisionId),
        approverContactId: contactId,
      })
    default:
      return writer.recordProposalRevision({
        id: text(payload.id),
        proposalId: text(payload.proposalId),
        authorContactId: contactId,
        changedFields: optionalList(payload.changedFields),
        title: optionalText(payload.title),
        summary: optionalText(payload.summary),
        requestedMinor: optionalNumber(payload.requestedMinor),
        currency: optionalText(payload.currency),
        location: optionalText(payload.location),
        schedule: optionalText(payload.schedule),
        personnel: optionalText(payload.personnel),
        eventFlow: optionalText(payload.eventFlow),
        note: optionalText(payload.note),
      })
  }
}
