import type { SupabaseClient } from '@supabase/supabase-js'
import { databaseRelation } from '@/lib/supabase/database-names'

// Shared by the website and the authenticated Agent catalog. Publication filtering and
// deterministic pagination belong to the data query, not to a model or a page of results.
export const RESOURCE_PUBLIC_FIELDS = 'id,slug,title,summary,public_url,resource_type,language,difficulty,topics,author_publisher,access_notes,featured'
export const EVENT_PUBLIC_FIELDS = 'id,slug,title,summary,format,timezone,country,state_region,city,venue_description,attendance_status,external_registration_url,relationship'

export function publishedResourcesQuery(client: SupabaseClient, fields: string = RESOURCE_PUBLIC_FIELDS) {
  return client.from('resources').select(fields).eq('publication_status', 'published')
    .order('sort_order').order('published_at', { ascending: false }).order('id')
}

export function publishedEventsQuery(client: SupabaseClient, fields = `*,${databaseRelation('event_sessions')}(starts_at,ends_at)`) {
  return client.from('events').select(fields).eq('publication_status', 'published')
    .order('created_at', { ascending: false }).order('id')
}
