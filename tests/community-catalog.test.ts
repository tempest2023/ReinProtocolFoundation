import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as unknown[], status: 200, available: true, urls: [] as URL[] }))
vi.mock('@/lib/env', () => ({ publicEnv: { siteUrl: 'https://foundation.example.org' } }))
vi.mock('@/lib/supabase/public', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { scopeDatabaseClient } = await import('@/lib/supabase/database-names')
  const client = scopeDatabaseClient(createClient('https://fixture.supabase.co', 'fixture-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url) => {
      state.urls.push(new URL(String(url)))
      return new Response(JSON.stringify(state.status === 200 ? state.rows : { message: 'private provider diagnostic' }), {
        status: state.status, headers: { 'content-type': 'application/json' },
      })
    } },
  }))
  return { getPublicClient: () => state.available ? client : null }
})
import { queryCommunityCatalog, literalPattern } from '@/lib/community/catalog'

const ID = '10000000-0000-4000-8000-000000000001'
const AT = '2026-10-20T12:00:00Z'
const resource = () => ({ id: ID, slug: 'synthetic-course', title: 'Synthetic course', summary: 'Learn agents',
  public_url: 'https://catalog.example.org/course', resource_type: 'Course', language: 'English', difficulty: null,
  topics: ['Agents'], author_publisher: null, access_notes: null, featured: false,
  access_verified_at: AT, updated_at: AT, publication_status: 'published' })
const event = () => ({ id: ID, slug: 'synthetic-event', title: 'Synthetic event', summary: 'Agent workshop',
  format: 'in_person', timezone: 'America/Los_Angeles', country: 'US', state_region: 'CA', city: 'San Francisco',
  venue_description: 'Public venue', attendance_status: 'waitlist', external_registration_url: 'https://catalog.example.org/register',
  relationship: 'Independent', updated_at: AT, publication_status: 'published',
  event_sessions: [{ starts_at: '2026-11-01T09:00:00Z', ends_at: '2026-11-01T10:00:00Z' }] })

beforeEach(() => {
  process.env.DATABASE_ENVIRONMENT = 'dev'
  state.rows = []; state.status = 200; state.available = true; state.urls = []
})

describe('authenticated catalog data queries', () => {
  it('uses the website publication query with server-side filters, stable ordering and lookahead', async () => {
    state.rows = [resource(), { ...resource(), id: ID.replace(/1$/, '2') }, { ...resource(), id: ID.replace(/1$/, '3') }]
    const response = await queryCommunityCatalog('community_resources_search', {
      query: 'agent', language: 'English', difficulty: 'beginner', topic: 'Agents', resourceType: 'Course', limit: 2, offset: 4,
    })
    expect(response).toMatchObject({ ok: true, status: 'found', environment: 'dev', source: 'foundation_catalog', hasMore: true, nextOffset: 6 })
    if (!response.ok) throw Error('query failed')
    expect(response.items).toHaveLength(2)
    expect(response.items[0]).toMatchObject({ id: ID, url: resource().public_url, verifiedAt: AT, updatedAt: AT, difficulty: null })
    const url = state.urls[0]
    expect(url.pathname).toBe('/rest/v1/dev_resources')
    expect(url.searchParams.get('publication_status')).toBe('eq.published')
    expect(url.searchParams.get('order')).toBe('sort_order.asc,published_at.desc,id.asc')
    expect(url.searchParams.get('language')).toBe('ilike.%English%')
    expect(url.searchParams.get('difficulty')).toBe('ilike.%beginner%')
    expect(url.searchParams.get('topics')).toBe('cs.{Agents}')
    expect(url.searchParams.get('resource_type')).toBe('eq.Course')
    expect(url.searchParams.get('offset')).toBe('4')
    expect(url.searchParams.get('limit')).toBe('3')
    expect(url.searchParams.get('select')).not.toMatch(/access_verified_by|source_submission_id|\*/)
  })

  it('keeps query punctuation inside a quoted literal and escapes LIKE wildcards', async () => {
    const input = 'x%,publication_status.eq.draft)_"\\*'
    await queryCommunityCatalog('community_resources_search', { query: input })
    const or = state.urls[0].searchParams.get('or')
    expect(or).toBe(`(title.ilike.${JSON.stringify(literalPattern(input))},summary.ilike.${JSON.stringify(literalPattern(input))})`)
    expect(literalPattern('%_*\\')).toBe('%\\%\\_\\*\\\\%')
    expect(state.urls[0].searchParams.get('publication_status')).toBe('eq.published')
  })

  it('uses future sessions joined to published events, with city/format filters before pagination', async () => {
    state.rows = [event()]
    const response = await queryCommunityCatalog('community_events_search', {
      city: 'San Francisco', format: 'in_person', startsAfter: '2026-10-31T00:00:00-07:00', startsBefore: '2026-11-02T00:00:00-08:00',
    })
    expect(response).toMatchObject({ ok: true, status: 'found', window: { startsAfter: '2026-10-31T00:00:00-07:00' },
      items: [{ timezone: 'America/Los_Angeles', registrationStatus: 'waitlist', url: 'https://foundation.example.org/community/gather/synthetic-event',
        sessions: [{ startsAt: '2026-11-01T09:00:00Z', endsAt: '2026-11-01T10:00:00Z' }] }] })
    const url = state.urls[0]
    expect(url.pathname).toBe('/rest/v1/dev_events')
    expect(url.searchParams.get('select')).toContain('event_sessions:dev_event_sessions!inner(starts_at,ends_at)')
    expect(url.searchParams.get('select')).not.toMatch(/approval_reference|image_permission_notes|\*/)
    expect(url.searchParams.get('publication_status')).toBe('eq.published')
    expect(url.searchParams.getAll('event_sessions.starts_at')).toEqual(['gte.2026-10-31T00:00:00-07:00', 'lt.2026-11-02T00:00:00-08:00'])
    expect(url.searchParams.get('city')).toBe('ilike.%San Francisco%')
    expect(url.searchParams.get('format')).toBe('eq.in_person')
  })

  it('defaults to the current instant and reports a truthful empty catalog', async () => {
    const before = Date.now()
    const response = await queryCommunityCatalog('community_events_search', {})
    expect(response).toMatchObject({ ok: true, status: 'empty', items: [], hasMore: false, nextOffset: null })
    const start = state.urls[0].searchParams.get('event_sessions.starts_at')!.slice(4)
    expect(Date.parse(start)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(start)).toBeLessThanOrEqual(Date.now())
  })

  it('details recheck publication, hide missing/unpublished records and retain all event sessions', async () => {
    const missing = await queryCommunityCatalog('community_resource_get', { id: ID })
    expect(missing).toMatchObject({ ok: true, status: 'not_found', items: [] })
    expect(state.urls[0].searchParams.get('id')).toBe(`eq.${ID}`)
    expect(state.urls[0].searchParams.get('publication_status')).toBe('eq.published')
    state.rows = [{ ...event(), body: 'Official description', approval_reference: 'private' }]
    const response = await queryCommunityCatalog('community_event_get', { id: ID })
    expect(response).toMatchObject({ ok: true, items: [{ body: 'Official description' }] })
    expect(JSON.stringify(response)).not.toContain('private')
    expect(state.urls[1].searchParams.has('event_sessions.starts_at')).toBe(false)
    expect(state.urls[1].searchParams.get('select')).not.toContain('!inner')
  })

  it.each([
    { limit: 21 }, { offset: -1 }, { actor: 'another-member' }, { environment: 'prod' },
    { publicationStatus: 'draft' }, { query: '' }, { query: ' ' }, { query: 'x'.repeat(161) },
  ])('rejects invalid resource input before accessing the database: %j', async input => {
    expect(await queryCommunityCatalog('community_resources_search', input)).toEqual({ ok: false, reason: 'invalid_request' })
    expect(state.urls).toEqual([])
  })

  it.each([
    { startsAfter: 'tomorrow' }, { startsAfter: '2026-02-30T00:00:00Z' }, { startsAfter: '2026-10-20T12:00:00' },
    { startsAfter: AT, startsBefore: AT }, { startsBefore: '2020-01-01T00:00:00Z' },
  ])('rejects ambiguous or invalid time windows before data lookup: %j', async input => {
    expect(await queryCommunityCatalog('community_events_search', input)).toEqual({ ok: false, reason: 'invalid_request' })
    expect(state.urls).toEqual([])
  })

  it('database outages, absent configuration and malformed rows are failures, never empty searches', async () => {
    state.status = 503
    expect(await queryCommunityCatalog('community_resources_search', {})).toEqual({ ok: false, reason: 'unavailable' })
    state.available = false
    expect(await queryCommunityCatalog('community_resources_search', {})).toEqual({ ok: false, reason: 'unavailable' })
    state.status = 200; state.available = true
    for (const row of [{ ...resource(), publication_status: 'archived' }, { ...resource(), public_url: 'javascript:alert(1)' }, { ...event(), timezone: 'Unknown/Zone' }]) {
      state.rows = [row]
      expect(await queryCommunityCatalog('community_resources_search', {})).toEqual({ ok: false, reason: 'unavailable' })
    }
  })
})
