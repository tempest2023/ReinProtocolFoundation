import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env'
import { authCookieOptions } from '@/lib/supabase/cookies'

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/auth/confirm' || request.nextUrl.pathname === '/auth/confirmed' || request.nextUrl.pathname === '/auth/code') {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
    const development = process.env.NODE_ENV === 'development'
    const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' ${development ? "'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${development ? 'ws: wss:' : ''}; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('Content-Security-Policy', csp)
    requestHeaders.set('x-nonce', nonce)
    const result = NextResponse.next({ request: { headers: requestHeaders } })
    result.headers.set('Content-Security-Policy', csp)
    result.headers.set('Cache-Control', 'private, no-store')
    result.headers.set('Referrer-Policy', 'no-referrer')
    result.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return result
  }
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseKey) return NextResponse.next({ request })
  let response = NextResponse.next({ request })
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, authCookieOptions(options)))
      },
    },
  })
  await supabase.auth.getUser()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = { matcher: ['/admin/:path*', '/auth/:path*'] }
