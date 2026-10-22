import 'server-only'
import { z } from 'zod'
import { publicEnv } from '@/lib/env'
import { getPublicClient } from '@/lib/supabase/public'
import { databaseEnvironment, databaseRelation } from '@/lib/supabase/database-names'
import { publishedEventsQuery, publishedResourcesQuery, RESOURCE_PUBLIC_FIELDS, EVENT_PUBLIC_FIELDS } from './queries'
import type { CommunityOperation } from '@/lib/agent/contracts'

const textFilter = z.string().trim().min(1).max(160)
const instant = z.string().datetime({ offset: true })
const page = { limit: z.number().int().min(1).max(20).default(3), offset: z.number().int().min(0).max(10000).default(0) }
const detail = z.object({ id: z.string().uuid() }).strict()
export const resourceSearchSchema = z.object({
  query: textFilter.optional(), language: textFilter.optional(), difficulty: textFilter.optional(),
  topic: textFilter.optional(), resourceType: z.enum(['Video', 'Article / Document', 'Course', 'Paper Discussion', 'Tool / Reference']).optional(),
  ...page,
}).strict()
export const eventSearchSchema = z.object({
  query: textFilter.optional(), city: textFilter.optional(),
  format: z.enum(['online', 'in_person', 'hybrid']).optional(),
  startsAfter: instant.optional(), startsBefore: instant.optional(), ...page,
}).strict().refine(value => !value.startsAfter || !value.startsBefore || Date.parse(value.startsBefore) > Date.parse(value.startsAfter))

const publicUrl = z.string().url().refine(value => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
})
const resourceRow = z.object({
  id: z.string().uuid(), slug: z.string(), title: z.string(), summary: z.string(), public_url: publicUrl,
  resource_type: z.string(), language: z.string(), difficulty: z.string().nullable(), topics: z.array(z.string()),
  author_publisher: z.string().nullable(), access_notes: z.string().nullable(),
  access_verified_at: instant.nullable(), updated_at: instant, publication_status: z.literal('published'),
})
const eventRow = z.object({
  id: z.string().uuid(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string(), summary: z.string(),
  body: z.string().nullable().optional(), format: z.enum(['online', 'in_person', 'hybrid']), timezone: z.string().refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
  }), country: z.string().nullable(), state_region: z.string().nullable(), city: z.string().nullable(),
  venue_description: z.string().nullable(), attendance_status: z.enum(['open', 'waitlist', 'full', 'closed']),
  external_registration_url: publicUrl, relationship: z.string(), updated_at: instant, publication_status: z.literal('published'),
  event_sessions: z.array(z.object({ starts_at: instant, ends_at: instant }).refine(s => Date.parse(s.ends_at) > Date.parse(s.starts_at))),
})

// Quote raw PostgREST logic values, and escape LIKE metacharacters. User text cannot add
// another predicate, drop the publication constraint, or turn '%' into a catalog wildcard.
export const literalPattern = (value: string) => `%${value.replace(/[\\%_*]/g, '\\$&')}%`
const textSearch = (value: string) => ['title', 'summary'].map(field => `${field}.ilike.${JSON.stringify(literalPattern(value))}`).join(',')
const failed = (reason: 'invalid_request' | 'unavailable') => ({ ok: false as const, reason })

/** Called only after service, assertion, channel and current member authorization. No cache. */
export async function queryCommunityCatalog(operation: CommunityOperation, input: unknown) {
  const schema = operation === 'community_resources_search' ? resourceSearchSchema
    : operation === 'community_events_search' ? eventSearchSchema : detail
  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) return failed('invalid_request')
  const client = getPublicClient()
  if (!client) return failed('unavailable')
  const retrievedAt = new Date().toISOString()
  try {
    const resources = operation === 'community_resources_search' || operation === 'community_resource_get'
    const isDetail = operation === 'community_resource_get' || operation === 'community_event_get'
    let query = resources
      ? publishedResourcesQuery(client, `${RESOURCE_PUBLIC_FIELDS},access_verified_at,updated_at,publication_status`)
      : publishedEventsQuery(client, `${EVENT_PUBLIC_FIELDS},updated_at,publication_status${isDetail ? ',body' : ''},${databaseRelation('event_sessions')}${isDetail ? '' : '!inner'}(starts_at,ends_at)`)
    let limit = 1
    let offset = 0
    let window: { startsAfter: string; startsBefore: string | null } | null = null
    if (isDetail) {
      query = query.eq('id', (parsed.data as z.infer<typeof detail>).id).limit(1)
    } else if (resources) {
      const args = parsed.data as z.infer<typeof resourceSearchSchema>
      ;({ limit, offset } = args)
      if (args.query) query = query.or(textSearch(args.query))
      if (args.language) query = query.ilike('language', literalPattern(args.language))
      if (args.difficulty) query = query.ilike('difficulty', literalPattern(args.difficulty))
      if (args.topic) query = query.contains('topics', [args.topic])
      if (args.resourceType) query = query.eq('resource_type', args.resourceType)
    } else {
      const args = parsed.data as z.infer<typeof eventSearchSchema>
      ;({ limit, offset } = args)
      const startsAfter = args.startsAfter ?? retrievedAt
      if (args.startsBefore && Date.parse(args.startsBefore) <= Date.parse(startsAfter)) return failed('invalid_request')
      window = { startsAfter, startsBefore: args.startsBefore ?? null }
      query = query.gte('event_sessions.starts_at', startsAfter)
      if (args.startsBefore) query = query.lt('event_sessions.starts_at', args.startsBefore)
      if (args.query) query = query.or(textSearch(args.query))
      if (args.city) query = query.ilike('city', literalPattern(args.city))
      if (args.format) query = query.eq('format', args.format)
    }
    if (!isDetail) query = query.range(offset, offset + limit)
    // A conversational lookup has one bounded attempt; retries must not turn an outage into
    // a long-running turn whose identity proof may expire.
    const { data, error } = await query.retry(false).abortSignal(AbortSignal.timeout(8000))
    if (error || !Array.isArray(data)) return failed('unavailable')
    const rows = z.array(resources ? resourceRow : eventRow).safeParse(data)
    if (!rows.success) return failed('unavailable')
    const items = rows.data.slice(0, limit).map(row => {
      if ('public_url' in row) return {
        id: row.id, title: row.title, summary: row.summary, url: row.public_url,
        type: row.resource_type, language: row.language, difficulty: row.difficulty, topics: row.topics,
        authorPublisher: row.author_publisher, accessNotes: row.access_notes,
        verifiedAt: row.access_verified_at, updatedAt: row.updated_at, publicationStatus: row.publication_status,
      }
      return {
        id: row.id, title: row.title, summary: row.summary, url: new URL(`/community/gather/${row.slug}`, publicEnv.siteUrl).href,
        ...(isDetail ? { body: row.body ?? null } : {}),
        format: row.format, timezone: row.timezone, country: row.country, region: row.state_region, city: row.city,
        venue: row.venue_description, registrationStatus: row.attendance_status, registrationUrl: row.external_registration_url,
        relationship: row.relationship, updatedAt: row.updated_at, publicationStatus: row.publication_status,
        sessions: [...row.event_sessions].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
          .map(s => ({ startsAt: s.starts_at, endsAt: s.ends_at })),
      }
    })
    const hasMore = !isDetail && rows.data.length > limit
    return {
      ok: true as const, status: items.length ? 'found' as const : isDetail ? 'not_found' as const : 'empty' as const,
      source: 'foundation_catalog' as const, environment: databaseEnvironment(), retrievedAt, items,
      hasMore, nextOffset: hasMore ? offset + limit : null, ...(window ? { window } : {}),
    }
  } catch {
    return failed('unavailable')
  }
}
