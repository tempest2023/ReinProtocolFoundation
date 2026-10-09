import 'server-only'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import { publicEnv } from '@/lib/env'

// Keep writes pending until the final response is known, including every chunk
// and stale-chunk deletion. Cookie failures are intentionally not swallowed.
export function createSupabaseRouteClient(request: NextRequest) {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseKey) throw new Error('auth_not_configured')
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const pendingHeaders = new Headers()
  const client = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const cookie of cookies) pending.set(cookie.name, cookie)
        for (const [key, value] of Object.entries(headers)) pendingHeaders.set(key, value)
      },
    },
  })
  return {
    client,
    applyCookies(response: NextResponse) {
      for (const { name, value, options } of pending.values()) response.cookies.set(name, value, options)
      pendingHeaders.forEach((value, key) => response.headers.set(key, value))
      return response
    },
  }
}
