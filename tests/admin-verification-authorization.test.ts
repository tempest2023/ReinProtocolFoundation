import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ eq: vi.fn(), maybeSingle: vi.fn(), allowlist: new Set<string>() }))
vi.mock('@/lib/env', () => ({ adminEmails: () => mocks.allowlist }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/supabase/secret', () => ({ requireSecretClient: () => ({ from: () => ({ select: () => ({ eq: mocks.eq }) }) }) }))
import { isAllowedAdminUser } from '@/lib/admin/auth'

describe('verified administrator identity', () => {
  beforeEach(() => { mocks.allowlist.clear(); mocks.eq.mockReset(); mocks.maybeSingle.mockReset(); mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle }) })
  it('accepts environment-listed verified email identities', async () => {
    mocks.allowlist.add('admin@example.org')
    expect(await isAllowedAdminUser({ id: 'verified-id', email: 'ADMIN@example.org' })).toBe(true)
    expect(mocks.eq).not.toHaveBeenCalled()
  })
  it('queries active records by verified user ID and ignores editable metadata', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { active: false }, error: null })
    const user = { id: 'actual-user', email: 'other@example.org', user_metadata: { role: 'admin', email: 'admin@example.org' } }
    expect(await isAllowedAdminUser(user)).toBe(false)
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'actual-user')
    mocks.maybeSingle.mockResolvedValue({ data: { active: true }, error: null })
    expect(await isAllowedAdminUser(user)).toBe(true)
  })
  it('distinguishes unavailable authorization from an inactive user', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
    await expect(isAllowedAdminUser({ id: 'verified-id', email: 'other@example.org' })).rejects.toThrow('admin_authorization_unavailable')
  })
})
