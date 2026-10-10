import type { CookieOptions } from '@supabase/ssr'

export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

// Apply at the write boundary: @supabase/ssr currently overrides cookieOptions.maxAge
// with its 400-day default. Keep deletion writes intact, including stale chunks.
export function authCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    maxAge: options.maxAge !== undefined && options.maxAge <= 0
      ? options.maxAge
      : AUTH_COOKIE_MAX_AGE,
  }
}
