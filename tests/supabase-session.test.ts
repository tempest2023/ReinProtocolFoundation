// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CookieMethodsServer } from '@supabase/ssr'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getUser: vi.fn(), set: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: mocks.set }) }))
vi.mock('@/lib/env', () => ({ publicEnv: { supabaseUrl: 'https://local-project.supabase.test', supabaseKey: 'sb_publishable_test' } }))
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { proxy } from '@/proxy'
import { AUTH_COOKIE_MAX_AGE } from '@/lib/supabase/cookies'

const writes = [
  { name: 'sb-project-auth-token.0', value: 'refreshed', options: { path: '/', sameSite: 'lax' as const, maxAge: 400 * 86400 } },
  { name: 'sb-project-auth-token.1', value: '', options: { path: '/', maxAge: 0 } },
]

describe('persistent Auth cookies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } })
  })

  it('writes 30-day cookies from server actions while preserving chunk removal', async () => {
    await createSupabaseServerClient()
    const cookies = mocks.createServerClient.mock.calls[0][2].cookies as CookieMethodsServer
    cookies.setAll!(writes, {})
    expect(mocks.set).toHaveBeenCalledWith(writes[0].name, 'refreshed', expect.objectContaining({ maxAge: AUTH_COOKIE_MAX_AGE, sameSite: 'lax', path: '/' }))
    expect(mocks.set).toHaveBeenCalledWith(writes[1].name, '', expect.objectContaining({ maxAge: 0 }))
  })

  it('renews persistence when the proxy refreshes an access token', async () => {
    mocks.getUser.mockImplementation(async () => {
      const cookies = mocks.createServerClient.mock.calls[0][2].cookies as CookieMethodsServer
      cookies.setAll!(writes, {})
      return { data: { user: null }, error: null }
    })
    const response = await proxy(new NextRequest('https://rein.test/admin'))
    expect(response.cookies.get(writes[0].name)?.maxAge).toBe(AUTH_COOKIE_MAX_AGE)
    expect(response.cookies.get(writes[1].name)?.maxAge).toBe(0)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
