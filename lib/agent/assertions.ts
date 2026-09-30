import 'server-only'
import { createHmac, createPublicKey, verify as verifySignature, timingSafeEqual } from 'node:crypto'
import { getSecretClient } from '@/lib/supabase/secret'
import { generateIngressAssertion, hashValue } from '@/lib/agent/credentials'
import { refuse, type MachineRefusal } from '@/lib/agent/contracts'

/**
 * Provenance for the platform events the Agent relays.
 *
 * A signed HTTP delivery from Slack or Discord is verified here against the raw
 * request body, so the platform itself vouches for the payload. A relay that
 * carries Socket Mode or Gateway traffic has no per-message signature, so it
 * must be an explicitly enrolled caller and the backend re-derives the tuple
 * from the relayed event while binding it to that caller's allowlist.
 *
 * Either way the result is a short-lived assertion: an opaque value that stands
 * for one verified event. It is returned to the relay, never accepted from a
 * model argument, and consumed exactly once.
 */

export const ASSERTION_TTL_MS = 5 * 60 * 1000
export const INGRESS_SKEW_SECONDS = 300

const SLACK_VERSION = 'v0'

/** Slack signs `v0:{timestamp}:{rawBody}` with the app signing secret. */
export function verifySlackSignature(input: {
  signingSecret: string
  timestamp: string | null
  rawBody: string
  signature: string | null
  nowSeconds?: number
}): boolean {
  const { signingSecret, timestamp, rawBody, signature } = input
  if (!signingSecret || !timestamp || !signature) return false
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestampSeconds) > INGRESS_SKEW_SECONDS) return false

  const expected = `${SLACK_VERSION}:${timestamp}:${rawBody}`
  const computed = `${SLACK_VERSION}=${createHmac('sha256', signingSecret).update(expected).digest('hex')}`
  return constantTimeTextEqual(computed, signature)
}

/**
 * Discord signs `{timestamp}{rawBody}` with its Ed25519 application key. The
 * configured value is the raw 32-byte public key in hex, which is wrapped in
 * the fixed Ed25519 SPKI prefix before verification.
 */
export function verifyDiscordSignature(input: {
  publicKeyHex: string
  timestamp: string | null
  rawBody: string
  signatureHex: string | null
  nowSeconds?: number
}): boolean {
  const { publicKeyHex, timestamp, rawBody, signatureHex } = input
  if (!publicKeyHex || !timestamp || !signatureHex) return false
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestampSeconds) > INGRESS_SKEW_SECONDS) return false
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) return false
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyHex, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    })
    return verifySignature(
      null,
      Buffer.from(`${timestamp}${rawBody}`, 'utf8'),
      key,
      Buffer.from(signatureHex, 'hex'),
    )
  } catch {
    return false
  }
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

export interface MintAssertionInput {
  callerId: string
  platform: string
  workspaceId: string
  platformUserId: string
  channelId: string
  eventId: string
  source: 'http_signature' | 'relay'
  payloadDigest: string
}

/** Mint one short-lived assertion bound to a verified platform event. */
export async function mintIngressAssertion(
  input: MintAssertionInput,
): Promise<{ ok: true; assertion: string; expiresAt: string } | MachineRefusal> {
  const client = getSecretClient()
  if (!client) return refuse('not_configured', 503)

  const assertion = generateIngressAssertion()
  const expiresAt = new Date(Date.now() + ASSERTION_TTL_MS).toISOString()
  const { error } = await client.from('rein_ingress_assertions').insert({
    assertion_token_hash: hashValue(assertion),
    caller_id: input.callerId,
    platform: input.platform,
    platform_workspace_id: input.workspaceId,
    platform_user_id: input.platformUserId,
    platform_channel_id: input.channelId,
    event_id: input.eventId,
    source: input.source,
    payload_digest: input.payloadDigest,
    expires_at: expiresAt,
  })
  if (error) return error.code === '23505' ? refuse('event_already_asserted', 409) : refuse('unavailable', 503)
  return { ok: true, assertion, expiresAt }
}

export interface ValidatedAssertion {
  callerId: string
  platform: string
  workspaceId: string
  platformUserId: string
  channelId: string
  eventId: string
}

/**
 * Validate one assertion. It stays usable until it expires, so a turn that reads
 * a member, then a proposal, then casts a ballot can present the same proof each
 * time. Only the channel-binding code is single use.
 */
export async function validateIngressAssertion(
  assertion: string,
): Promise<{ ok: true; assertion: ValidatedAssertion } | MachineRefusal> {
  const client = getSecretClient()
  if (!client) return refuse('not_configured', 503)
  const { data, error } = await client.rpc('rein_validate_ingress_assertion', {
    p_assertion_hash: hashValue(assertion),
  })
  if (error) return refuse('unavailable', 503)
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  if (!row || row.ok !== true) {
    const reason = typeof row?.reason === 'string' ? row.reason : 'proof_unknown'
    const mapped = reason === 'proof_expired' ? reason : 'proof_unknown'
    return refuse(mapped, 401)
  }
  return {
    ok: true,
    assertion: {
      callerId: String(row.caller_id ?? ''),
      platform: String(row.platform ?? ''),
      workspaceId: String(row.platform_workspace_id ?? ''),
      platformUserId: String(row.platform_user_id ?? ''),
      channelId: String(row.platform_channel_id ?? ''),
      eventId: String(row.event_id ?? ''),
    },
  }
}
