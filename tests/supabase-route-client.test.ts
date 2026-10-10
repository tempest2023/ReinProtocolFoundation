// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CookieMethodsServer } from '@supabase/ssr'
const createServerClient = vi.hoisted(() => vi.fn())
vi.mock('@supabase/ssr', () => ({ createServerClient }))
vi.mock('@/lib/env', () => ({ publicEnv: { supabaseUrl: 'https://local-project.supabase.test', supabaseKey: 'sb_publishable_test' } }))
import { createSupabaseRouteClient } from '@/lib/supabase/route'

describe('writable Supabase Route Handler adapter', () => {
  beforeEach(() => createServerClient.mockReset())
  it('passes only the publishable key, reads incoming cookies and writes every chunk and SSR cache header', () => {
    const request = new NextRequest('https://rein.test/api/auth/verify', { headers: { cookie: 'sb-old-auth-token.0=old' } })
    const { applyCookies } = createSupabaseRouteClient(request)
    expect(createServerClient).toHaveBeenCalledWith('https://local-project.supabase.test', 'sb_publishable_test', expect.any(Object))
    const cookies = createServerClient.mock.calls[0][2].cookies as CookieMethodsServer
    expect(cookies.getAll!()).toEqual([{ name: 'sb-old-auth-token.0', value: 'old' }])
    cookies.setAll!([
      { name: 'sb-old-auth-token.0', value: 'chunk-0', options: { path: '/', secure: true, maxAge: 400 * 86400 } },
      { name: 'sb-old-auth-token.1', value: 'chunk-1', options: { path: '/', sameSite: 'lax' } },
      { name: 'sb-old-auth-token.2', value: '', options: { path: '/', maxAge: 0 } },
    ], { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0', Pragma: 'no-cache', Expires: '0' })
    const response = applyCookies(NextResponse.json({ status: 'verified' }))
    expect(response.cookies.getAll()).toHaveLength(3)
    expect(response.cookies.get('sb-old-auth-token.1')?.value).toBe('chunk-1')
    expect(response.cookies.get('sb-old-auth-token.0')?.maxAge).toBe(30 * 86400)
    expect(response.cookies.get('sb-old-auth-token.1')?.maxAge).toBe(30 * 86400)
    expect(response.cookies.get('sb-old-auth-token.0')?.secure).toBe(true)
    expect(response.cookies.get('sb-old-auth-token.2')?.maxAge).toBe(0)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
  })

  it('keeps the last cookie value and does not swallow response cookie failures', () => {
    const { applyCookies } = createSupabaseRouteClient(new NextRequest('https://rein.test'))
    const cookies = createServerClient.mock.calls[0][2].cookies as CookieMethodsServer
    cookies.setAll!([{ name: 'session', value: 'first', options: {} }], {})
    cookies.setAll!([{ name: 'session', value: 'last', options: {} }], {})
    const response = NextResponse.json({})
    expect(applyCookies(response).cookies.get('session')?.value).toBe('last')
    vi.spyOn(response.cookies, 'set').mockImplementation(() => { throw new Error('cookie write failed') })
    expect(() => applyCookies(response)).toThrow('cookie write failed')
  })
})
