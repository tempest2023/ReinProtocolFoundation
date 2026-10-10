import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/env'
import { scopeDatabaseClient } from '@/lib/supabase/database-names'
import { authCookieOptions } from '@/lib/supabase/cookies'

export async function createSupabaseServerClient() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseKey) return null
  const cookieStore = await cookies()
  return scopeDatabaseClient(createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, authCookieOptions(options)))
        } catch {
          // Server Components cannot write cookies. The proxy refreshes sessions.
        }
      },
    },
  }))
}
