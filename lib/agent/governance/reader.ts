// Read-only server-side reader for the Supabase tables that back platform identity binding and
// human-entered available-funds figures.
//
// Scope: PRD R02 (verify identity links and current eligibility; display names and platform role
// labels never establish identity), R21 (a designated finance lead records financial figures that
// the Agent may read) and the fail-closed posture required by AC01/AC06. The table contract below
// is the sibling foundation migration
// `supabase/migrations/20260924094436_rein_slack_identity_and_fund_snapshots.sql`, read-only:
//
//   public.<env>_rein_platform_links(platform, platform_workspace_id, platform_user_id, contact_id,
//     status, validity_expires_at, verified_at, verified_by, revoked_at, revoked_by)
//                                                -- status is 'verified' or 'revoked'
//   public.<env>_rein_fund_snapshots(currency, available_minor, recorded_at, recorded_by,
//     source_note)                               -- human entered, integer minor units
//   public.<env>_community_contacts(id)
//   public.<env>_contributors(id, contact_id, status)
//   public.<env>_people(contact_id, contributor_id, person_type)
//
// Access model: those tables enable RLS, grant nothing to `anon` or `authenticated` and are
// readable by `service_role` only, so this reader authenticates with the server-only secret key
// over PostgREST. The key generation decides the transport: a legacy `service_role` JWT travels in
// both the `apikey` and the bearer header, while a modern secret key is presented in `apikey`
// only, because Supabase never accepts one as a bearer token. The key is never logged, echoed in
// an error, placed in a URL or returned to a caller: every failure collapses to a fixed reason
// code, and a response body is never propagated.
//
// Limitations, because they decide what an answer means:
// - The caller supplies the platform tuple (`platform`, workspace ID, user ID) as it received it
//   from trusted host context. This reader proves that the whole tuple is bound to a contact. It
//   cannot prove that a later caller is that user, so callers must never accept a model-supplied
//   tuple.
// - A link row is the grant: exactly one `<env>_rein_platform_links` row must match the whole tuple,
//   carry status `verified`, keep the verification decision it rests on, and not be expired. A
//   `revoked` row is the veto, and a row whose tuple, status, verification or expiry is malformed
//   fails closed. Every request derives the contact and its current role again, and nothing here
//   creates, updates or persists a link.
// - This module only reads. It never reserves, approves, spends or reconciles money, and a funds
//   answer is an operator-entered figure, not a payment instruction.
// - Freshness and deadline rules stay with the caller. The one clock read here is the expiry
//   comparison on `validity_expires_at`, because a live validity window is part of the grant.
// - `people.person_type` is the only role source used. Free-text `people.role` and the publication
//   state are never selected, because neither establishes eligibility (R02).

import { publicEnv } from '@/lib/env';
import { databaseEnvironment } from '@/lib/supabase/database-names';

export type FoundationEnvironment = 'dev' | 'prod';

export interface FoundationDbReaderConfig {
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

export type MemberStatus =
  | 'resolved'
  | 'invalid_request'
  | 'identity_not_linked'
  | 'identity_link_ambiguous'
  | 'identity_link_revoked'
  | 'identity_link_malformed'
  | 'identity_link_conflict'
  | 'member_record_malformed'
  | 'unavailable';

export interface MemberResolution {
  status: MemberStatus;
  /** Fixed reason code. Never provider text, and never part of the secret key. */
  reason: string;
  /** Canonical contact ID. Non-null only when `status` is `'resolved'`. */
  contactId: string | null;
  /**
   * Which evidence resolved the member: `'platform_link'` for one verified, unexpired
   * `rein_platform_links` row matching the whole platform tuple. Null whenever `status` is not
   * `'resolved'`.
   */
  matchedBy: 'platform_link' | null;
  /** True only for a Contributor row whose `status` is exactly `'active'`. */
  isActiveContributor: boolean;
  /** Derived from `people.person_type = 'director'` via `contact_id` or `contributor_id`. */
  isDirector: boolean;
  /** HTTP status for a provider failure, otherwise null. */
  httpStatus: number | null;
}

/**
 * The platform tuple a caller wants resolved. Every part is caller input, so all three are
 * validated before any row is read, and a row must match the whole tuple to be evidence.
 */
export interface ResolveMemberInput {
  /** Platform name, for example the chat platform the binding belongs to. */
  platform: string;
  /** Workspace, team or guild ID inside that platform. */
  workspaceId: string;
  /** The user ID inside that workspace. */
  platformUserId: string;
}

export type AvailableFundsStatus = 'snapshot' | 'unknown' | 'invalid_request' | 'unavailable';

export interface AvailableFunds {
  status: AvailableFundsStatus;
  reason: string;
  /** The requested currency, or null when the request itself was rejected. */
  currency: string | null;
  /** Integer minor units. Non-null only when `status` is `'snapshot'`. */
  availableMinor: number | null;
  recordedAt: string | null;
  recordedBy: string | null;
  sourceNote: string | null;
  httpStatus: number | null;
  /** Always false: this figure is informational and never authorizes spending. */
  authorizesSpending: false;
}

export interface FoundationDbReader {
  readonly environment: FoundationEnvironment;
  readonly tablePrefix: string;
  /**
   * Resolve one platform tuple to its canonical contact ID and current Contributor/director flags.
   */
  resolveMember(input: ResolveMemberInput): Promise<MemberResolution>;
  /** Latest human-entered available-funds snapshot for one currency, or an explicit unknown. */
  readAvailableFunds(currency: string): Promise<AvailableFunds>;
}

interface QueryFailure {
  ok: false;
  reason: string;
  httpStatus: number | null;
}

interface QuerySuccess {
  ok: true;
  rows: readonly unknown[];
}

type QueryOutcome = QueryFailure | QuerySuccess;

const PLATFORM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * Loopback hostnames, where a plaintext HTTP project URL is a local hop and never crosses a network.
 * Any other host must use HTTPS so the server key is never sent over an unencrypted connection.
 */
export const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const LINK_STATUSES = Object.freeze(['verified', 'revoked']);
const CONTRIBUTOR_STATUSES = Object.freeze(['active', 'inactive']);
const PERSON_TYPES = Object.freeze(['director', 'core_contributor']);

/**
 * Supabase serves two generations of server key and they travel differently. A legacy
 * `service_role` key is a three-segment JWT, which PostgREST expects in both the `apikey` and the
 * `Authorization: Bearer` header. A modern secret key is not a JWT: Supabase never accepts it as a
 * bearer token, so presenting one there turns every read, write and RPC into a 401. Only the shape
 * of the key decides the headers, and the key itself never appears in a URL, a body or a result.
 */
const LEGACY_JWT_KEY_PATTERN = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * The `apikey` header always, plus a bearer token only for a legacy JWT key. Shared with the
 * writer so reads, writes and RPCs authenticate identically.
 */
export const supabaseServiceRoleHeaders = (serviceRoleKey: string): Record<string, string> => {
  const headers: Record<string, string> = { apikey: serviceRoleKey };
  if (LEGACY_JWT_KEY_PATTERN.test(serviceRoleKey)) headers.authorization = `Bearer ${serviceRoleKey}`;
  return headers;
};

/**
 * 401 and 403 are the server key rejected before any table policy or trigger runs. Both are a
 * connection-authentication failure, never a governance decision, and both stay `unavailable`.
 */
export const isSupabaseAuthFailureStatus = (httpStatus: number): boolean =>
  httpStatus === 401 || httpStatus === 403;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const isoInstant = (value: unknown): string | null =>
  typeof value === 'string' && ISO_INSTANT_PATTERN.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : null;

/** `undefined` means present but malformed; `null` means the column is null. */
const optionalUuid = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
};

const configError = (message: string): Error => new Error(`foundation db reader config: ${message}`);

const memberFailure = (
  status: MemberStatus,
  reason: string,
  httpStatus: number | null = null,
): MemberResolution => ({
  status,
  reason,
  contactId: null,
  matchedBy: null,
  isActiveContributor: false,
  isDirector: false,
  httpStatus,
});

const fundsFailure = (
  status: AvailableFundsStatus,
  reason: string,
  currency: string | null,
  httpStatus: number | null = null,
): AvailableFunds => ({
  status,
  reason,
  currency,
  availableMinor: null,
  recordedAt: null,
  recordedBy: null,
  sourceNote: null,
  httpStatus,
  authorizesSpending: false,
});

/**
 * Build a reader bound to the current database environment.
 *
 * Throws only for invalid configuration, which is an operator error and not a data path. Failed
 * lookups resolve to a closed result instead, so a caller cannot mistake an error for an answer.
 */
export function createFoundationDbReader(config: FoundationDbReaderConfig): FoundationDbReader {
  // Configuration is resolved lazily, on the first query. A deployment that
  // has not wired the database yet still loads and answers with a closed
  // failure, instead of failing at import time.
  let resolved: { baseUrl: string; serviceRoleKey: string } | null = null;
  const resolveConfig = (): { baseUrl: string; serviceRoleKey: string } => {
    if (resolved) return resolved;
    const rawUrl = typeof publicEnv.supabaseUrl === 'string' ? publicEnv.supabaseUrl.trim() : '';
    if (!rawUrl) throw configError('supabaseUrl is required');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw configError('supabaseUrl must be an absolute URL');
    }
    if (parsedUrl.protocol !== 'https:') {
      // The server key travels in a request header, so a plaintext project URL would expose it in
      // transit. Loopback is a local-development address whose hop never leaves the machine, and it
      // stays the one explicit exception.
      if (parsedUrl.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(parsedUrl.hostname)) {
        throw configError('supabaseUrl must use https, or http on a loopback address for local development');
      }
    }
    if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
      throw configError('supabaseUrl must be a bare project URL without credentials, query or fragment');
    }
    const configuredServiceRoleKey = process.env.SUPABASE_SECRET_KEY;
    const serviceRoleKey =
      typeof configuredServiceRoleKey === 'string' ? configuredServiceRoleKey.trim() : '';
    if (!serviceRoleKey) throw configError('serviceRoleKey is required');
    resolved = { baseUrl: rawUrl.replace(/\/+$/, ''), serviceRoleKey };
    return resolved;
  };

  const environment: FoundationEnvironment = databaseEnvironment();

  const fetchImpl = config?.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw configError('a fetch implementation is required');

  const tablePrefix = `${environment}_`;

  const requestRows = async (table: string, params: Record<string, string>): Promise<QueryOutcome> => {
    let baseUrl: string;
    let serviceRoleKey: string;
    try {
      ({ baseUrl, serviceRoleKey } = resolveConfig());
    } catch {
      return { ok: false, reason: 'not_configured', httpStatus: null };
    }
    const query = new URLSearchParams(params).toString();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/rest/v1/${table}?${query}`, {
        method: 'GET',
        headers: {
          ...supabaseServiceRoleHeaders(serviceRoleKey),
          accept: 'application/json',
        },
      });
    } catch {
      return { ok: false, reason: 'transport_error', httpStatus: null };
    }
    const httpStatus = typeof response?.status === 'number' ? response.status : null;
    if (!response || response.ok !== true) {
      // A rejected key is named as its own reason so a caller never reads an authentication failure
      // as a plain provider error.
      const reason =
        httpStatus !== null && isSupabaseAuthFailureStatus(httpStatus) ? 'auth_error' : 'http_error';
      return { ok: false, reason, httpStatus };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'response_malformed', httpStatus };
    }
    if (!Array.isArray(body)) return { ok: false, reason: 'response_malformed', httpStatus };
    return { ok: true, rows: body };
  };

  /**
   * The member-record proof a resolved binding rests on: the contact exists exactly once, its
   * optional Contributor row is consistent, and `people.person_type` decides the director flag.
   */
  const resolveMemberRecord = async (
    contactId: string,
  ): Promise<{ ok: true; isActiveContributor: boolean; isDirector: boolean } | { ok: false; result: MemberResolution }> => {
    const contacts = await requestRows(`${tablePrefix}community_contacts`, {
      select: 'id,deleted_at',
      id: `eq.${contactId}`,
      limit: '2',
    });
    if (!contacts.ok) {
      return { ok: false, result: memberFailure('unavailable', contacts.reason, contacts.httpStatus) };
    }
    if (contacts.rows.length === 0) {
      return { ok: false, result: memberFailure('member_record_malformed', 'contact_missing') };
    }
    if (contacts.rows.length > 1) {
      return { ok: false, result: memberFailure('member_record_malformed', 'contact_ambiguous') };
    }
    const rawContact = contacts.rows[0];
    if (!isPlainObject(rawContact) || rawContact.id !== contactId) {
      return { ok: false, result: memberFailure('member_record_malformed', 'contact_row_malformed') };
    }

    const contributors = await requestRows(`${tablePrefix}contributors`, {
      select: 'id,contact_id,status',
      contact_id: `eq.${contactId}`,
      limit: '2',
    });
    if (!contributors.ok) {
      return { ok: false, result: memberFailure('unavailable', contributors.reason, contributors.httpStatus) };
    }
    if (contributors.rows.length > 1) {
      return { ok: false, result: memberFailure('member_record_malformed', 'contributor_ambiguous') };
    }
    let contributorId: string | null = null;
    let isActiveContributor = false;
    if (contributors.rows.length === 1) {
      const rawContributor = contributors.rows[0];
      if (!isPlainObject(rawContributor)) {
        return { ok: false, result: memberFailure('member_record_malformed', 'contributor_row_malformed') };
      }
      const contributor = optionalUuid(rawContributor.id);
      if (!contributor) {
        return { ok: false, result: memberFailure('member_record_malformed', 'contributor_id_malformed') };
      }
      if (rawContributor.contact_id !== contactId) {
        return { ok: false, result: memberFailure('member_record_malformed', 'contributor_contact_mismatch') };
      }
      const contributorStatus = rawContributor.status;
      if (typeof contributorStatus !== 'string' || !CONTRIBUTOR_STATUSES.includes(contributorStatus)) {
        return { ok: false, result: memberFailure('member_record_malformed', 'contributor_status_malformed') };
      }
      contributorId = contributor;
      isActiveContributor = contributorStatus === 'active';
    }

    // A director may be linked through the contact or through the Contributor record, so both keys
    // are queried. `people` is unique on `contact_id` and on `contributor_id`, so at most two rows
    // can match.
    const peopleParams: Record<string, string> = { select: 'contact_id,contributor_id,person_type', limit: '3' };
    if (contributorId) peopleParams.or = `(contact_id.eq.${contactId},contributor_id.eq.${contributorId})`;
    else peopleParams.contact_id = `eq.${contactId}`;
    const people = await requestRows(`${tablePrefix}people`, peopleParams);
    if (!people.ok) {
      return { ok: false, result: memberFailure('unavailable', people.reason, people.httpStatus) };
    }

    let isDirector = false;
    for (const rawPerson of people.rows) {
      if (!isPlainObject(rawPerson)) {
        return { ok: false, result: memberFailure('member_record_malformed', 'person_row_malformed') };
      }
      const personContactId = optionalUuid(rawPerson.contact_id);
      const personContributorId = optionalUuid(rawPerson.contributor_id);
      if (personContactId === undefined || personContributorId === undefined) {
        return { ok: false, result: memberFailure('member_record_malformed', 'person_identifier_malformed') };
      }
      const personType = rawPerson.person_type;
      if (typeof personType !== 'string' || !PERSON_TYPES.includes(personType)) {
        return { ok: false, result: memberFailure('member_record_malformed', 'person_type_malformed') };
      }
      const matchesContact = personContactId === contactId;
      const matchesContributor = contributorId !== null && personContributorId === contributorId;
      if (!matchesContact && !matchesContributor) {
        return { ok: false, result: memberFailure('member_record_malformed', 'person_row_out_of_scope') };
      }
      if (personType === 'director') isDirector = true;
    }

    return { ok: true, isActiveContributor, isDirector };
  };

  /**
   * The grant. Exactly one `<env>_rein_platform_links` row must match the whole platform tuple, and
   * a contact may hold several bindings, so nothing here constrains one contact to one platform
   * identity. The row is the evidence: it must be `verified`, keep the verification decision it
   * rests on, carry no revocation, and not be expired. Every outcome is closed: a resolved member,
   * or a result a caller returns as-is.
   */
  const resolveMember = async (input: ResolveMemberInput): Promise<MemberResolution> => {
    const platform = typeof input?.platform === 'string' ? input.platform.trim() : '';
    if (!PLATFORM_ID_PATTERN.test(platform)) {
      return memberFailure('invalid_request', 'platform_invalid');
    }
    const workspaceId = typeof input?.workspaceId === 'string' ? input.workspaceId.trim() : '';
    if (!PLATFORM_ID_PATTERN.test(workspaceId)) {
      return memberFailure('invalid_request', 'platform_workspace_id_invalid');
    }
    const platformUserId =
      typeof input?.platformUserId === 'string' ? input.platformUserId.trim() : '';
    if (!PLATFORM_ID_PATTERN.test(platformUserId)) {
      return memberFailure('invalid_request', 'platform_user_id_invalid');
    }

    const links = await requestRows(`${tablePrefix}rein_platform_links`, {
      select:
        'platform,platform_workspace_id,platform_user_id,contact_id,status,validity_expires_at,verified_at,verified_by,revoked_at',
      platform: `eq.${platform}`,
      platform_workspace_id: `eq.${workspaceId}`,
      platform_user_id: `eq.${platformUserId}`,
      // The tuple is unique across statuses, so a revoked row is a tombstone and a second row for
      // the same tuple is a contract breach.
      limit: '2',
    });
    if (!links.ok) return memberFailure('unavailable', links.reason, links.httpStatus);
    if (links.rows.length > 1) return memberFailure('identity_link_ambiguous', 'identity_link_ambiguous');
    if (links.rows.length === 0) return memberFailure('identity_not_linked', 'identity_not_linked');

    const rawLink = links.rows[0];
    if (!isPlainObject(rawLink)) return memberFailure('identity_link_malformed', 'link_row_malformed');
    // Re-check scope locally: a row outside the queried tuple is never a match, whatever the
    // server-side filter returned.
    if (
      rawLink.platform !== platform ||
      rawLink.platform_workspace_id !== workspaceId ||
      rawLink.platform_user_id !== platformUserId
    ) {
      return memberFailure('identity_link_malformed', 'link_row_out_of_scope');
    }
    const contactId = optionalUuid(rawLink.contact_id);
    if (!contactId) return memberFailure('identity_link_malformed', 'link_contact_id_malformed');
    const linkStatus = rawLink.status;
    if (typeof linkStatus !== 'string' || !LINK_STATUSES.includes(linkStatus)) {
      return memberFailure('identity_link_malformed', 'link_status_malformed');
    }
    // Both the verified and the revoked state must keep the verification decision they rest on.
    if (isoInstant(rawLink.verified_at) === null || nonEmptyText(rawLink.verified_by) === null) {
      return memberFailure('identity_link_malformed', 'link_verification_missing');
    }
    if (linkStatus === 'revoked') {
      if (isoInstant(rawLink.revoked_at) === null) {
        return memberFailure('identity_link_malformed', 'link_revocation_missing');
      }
      // The veto: a revoked row ends the answer, so a later consent record can never restore an
      // identity an administrator deliberately revoked.
      return memberFailure('identity_link_revoked', 'identity_link_revoked');
    }
    if (rawLink.revoked_at !== null) {
      return memberFailure('identity_link_malformed', 'link_revoked_at_unexpected');
    }
    // A live validity window is part of the grant: no expiry marker means the binding does not
    // expire, and anything else must be a parseable instant that has not passed yet.
    const validityExpiresAt = rawLink.validity_expires_at;
    if (validityExpiresAt !== null && validityExpiresAt !== undefined) {
      const expiresAt = isoInstant(validityExpiresAt);
      if (expiresAt === null) {
        return memberFailure('identity_link_malformed', 'link_validity_expires_at_malformed');
      }
      if (Date.parse(expiresAt) <= Date.now()) {
        return memberFailure('identity_not_linked', 'identity_link_expired');
      }
    }

    const record = await resolveMemberRecord(contactId);
    if (!record.ok) return record.result;
    return {
      status: 'resolved',
      reason: 'resolved',
      contactId,
      matchedBy: 'platform_link',
      isActiveContributor: record.isActiveContributor,
      isDirector: record.isDirector,
      httpStatus: null,
    };
  };

  const readAvailableFunds = async (currency: string): Promise<AvailableFunds> => {
    const code = typeof currency === 'string' ? currency.trim() : '';
    if (!CURRENCY_PATTERN.test(code)) {
      return fundsFailure('invalid_request', 'currency_invalid', code || null);
    }

    // One row only: the newest human entry by `recorded_at`, with insertion order as a deterministic
    // tie-break. The reader never sums, averages or combines snapshots.
    const result = await requestRows(`${tablePrefix}rein_fund_snapshots`, {
      select: 'currency,available_minor,recorded_at,recorded_by,source_note',
      currency: `eq.${code}`,
      order: 'recorded_at.desc,created_at.desc',
      limit: '1',
    });
    if (!result.ok) return fundsFailure('unavailable', result.reason, code, result.httpStatus);
    if (result.rows.length === 0) return fundsFailure('unknown', 'no_snapshot', code);

    const rawSnapshot = result.rows[0];
    if (!isPlainObject(rawSnapshot)) return fundsFailure('unknown', 'snapshot_malformed', code);
    if (rawSnapshot.currency !== code) return fundsFailure('unknown', 'snapshot_currency_mismatch', code);
    const availableMinor = rawSnapshot.available_minor;
    if (!Number.isSafeInteger(availableMinor) || (availableMinor as number) < 0) {
      return fundsFailure('unknown', 'snapshot_amount_malformed', code);
    }
    const recordedAt = isoInstant(rawSnapshot.recorded_at);
    if (recordedAt === null) return fundsFailure('unknown', 'snapshot_recorded_at_malformed', code);
    const recordedBy = nonEmptyText(rawSnapshot.recorded_by);
    if (recordedBy === null) return fundsFailure('unknown', 'snapshot_recorded_by_missing', code);
    const sourceNote = rawSnapshot.source_note;
    if (sourceNote !== null && typeof sourceNote !== 'string') {
      return fundsFailure('unknown', 'snapshot_source_note_malformed', code);
    }

    return {
      status: 'snapshot',
      reason: 'snapshot',
      currency: code,
      availableMinor: availableMinor as number,
      recordedAt,
      recordedBy,
      sourceNote,
      httpStatus: null,
      authorizesSpending: false,
    };
  };

  return Object.freeze({ environment, tablePrefix, resolveMember, readAvailableFunds });
}
