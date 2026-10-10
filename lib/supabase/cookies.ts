import type { CookieOptions } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'

export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

// Apply at the write boundary: @supabase/ssr currently overrides cookieOptions.maxAge
// with its 400-day default. Keep deletion writes intact, including stale chunks.
export function authCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    // Auth is server-only; browser JavaScript never needs these bearer credentials.
    httpOnly: true,
    secure: publicEnv.siteUrl.startsWith('https://') || Boolean(options.secure),
    maxAge: options.maxAge !== undefined && options.maxAge <= 0
      ? options.maxAge
      : AUTH_COOKIE_MAX_AGE,
  }
}
