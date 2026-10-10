import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialActionState } from '@/lib/community/types'

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  isAllowedAdminEmail: vi.fn(),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  consumeAuthRateLimits: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/rate-limit', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/rate-limit')>(), consumeAuthRateLimits: mocks.consumeAuthRateLimits }))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/admin/auth', () => ({ isAllowedAdminEmail: mocks.isAllowedAdminEmail }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
  })),
}))
vi.mock('@/lib/supabase/secret', () => ({
  requireSecretClient: vi.fn(() => ({ auth: { admin: { generateLink: mocks.generateLink } } })),
}))

import { requestAdminLink } from '@/app/admin/login/actions'

function loginForm(email = 'admin@example.org') {
  const formData = new FormData()
  formData.set('email', email)
  return formData
}

describe('administrator login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isAllowedAdminEmail.mockResolvedValue(true)
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'hashed-login-token' } },
      error: null,
    })
    mocks.verifyOtp.mockResolvedValue({ error: null })
    mocks.signInWithOtp.mockResolvedValue({ error: null })
    mocks.consumeAuthRateLimits.mockResolvedValue(undefined)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('creates a normal Supabase session without sending email in local development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', '')

    await expect(requestAdminLink(initialActionState, loginForm())).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.generateLink).toHaveBeenCalledWith(expect.objectContaining({
      type: 'magiclink',
      email: 'admin@example.org',
    }))
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hashed-login-token',
      type: 'email',
    })
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
    expect(mocks.redirect).toHaveBeenCalledWith('/admin')
    expect(mocks.consumeAuthRateLimits).not.toHaveBeenCalled()
  })

  it('uses the email magic-link flow outside the development bypass', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')

    await expect(requestAdminLink(initialActionState, loginForm())).resolves.toMatchObject({
      status: 'success',
      message: 'If this address is authorized, a sign-in link has been sent.',
    })

    expect(mocks.signInWithOtp).toHaveBeenCalledOnce()
    expect(mocks.generateLink).not.toHaveBeenCalled()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it.each([
    ['production', 'https://rein-protocol.org'],
    ['development', 'http://localhost:3000'],
    ['development', 'http://127.0.0.1:3000'],
  ])('sends the %s email link to the configured origin %s', async (nodeEnvironment, siteUrl) => {
    vi.stubEnv('NODE_ENV', nodeEnvironment)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', siteUrl)
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.resetModules()
    const { requestAdminLink: configuredRequestAdminLink } = await import('@/app/admin/login/actions')

    await expect(configuredRequestAdminLink(initialActionState, loginForm())).resolves.toMatchObject({ status: 'success' })

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'admin@example.org',
      options: { emailRedirectTo: `${siteUrl}/auth/confirm` },
    })
    expect(mocks.generateLink).not.toHaveBeenCalled()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('never creates a development session for an unauthorized address', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', '')
    mocks.isAllowedAdminEmail.mockResolvedValue(false)

    await expect(requestAdminLink(initialActionState, loginForm('unknown@example.org'))).resolves.toMatchObject({
      status: 'success',
      message: 'If this address is authorized, you will be signed in.',
    })

    expect(mocks.generateLink).not.toHaveBeenCalled()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('limits authorized and unauthorized email requests before checking eligibility', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mocks.isAllowedAdminEmail.mockResolvedValue(false)
    expect(await requestAdminLink(initialActionState, loginForm())).toMatchObject({ status: 'success' })
    expect(mocks.consumeAuthRateLimits).toHaveBeenCalledWith('send', expect.any(Headers), 'admin@example.org')
    expect(mocks.consumeAuthRateLimits.mock.invocationCallOrder[0]).toBeLessThan(mocks.isAllowedAdminEmail.mock.invocationCallOrder[0])
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('fails closed when the shared limiter is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mocks.consumeAuthRateLimits.mockRejectedValue(new Error('database failed'))
    expect(await requestAdminLink(initialActionState, loginForm())).toMatchObject({ status: 'error', message: 'Sign-in is temporarily unavailable. Please try again later.' })
    expect(mocks.isAllowedAdminEmail).not.toHaveBeenCalled()
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('uses the same response when an authorized email cannot be delivered', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mocks.signInWithOtp.mockResolvedValue({ error: { message: 'sensitive provider detail' } })
    expect(await requestAdminLink(initialActionState, loginForm())).toMatchObject({ status: 'success', message: 'If this address is authorized, a sign-in link has been sent.' })
  })
  it('uses a fixed code redirect and reports the submitted method without exposing eligibility', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const form = loginForm()
    form.set('method', 'code')
    const sent = await requestAdminLink(initialActionState, form)
    expect(sent).toMatchObject({ status: 'success', method: 'code', email: 'admin@example.org' })
    expect(sent.retryAt).toBeGreaterThan(Date.now())
    expect(mocks.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: 'http://localhost:3000/auth/code' } }))
    mocks.isAllowedAdminEmail.mockResolvedValue(false)
    expect(await requestAdminLink(initialActionState, form)).toMatchObject({ status: 'success', method: 'code', email: sent.email, message: sent.message })
  })

  it('rejects unknown and duplicate methods before sending', async () => {
    for (const methods of [['recovery'], ['code', 'magic-link']]) {
      const form = loginForm()
      for (const method of methods) form.append('method', method)
      expect(await requestAdminLink(initialActionState, form)).toMatchObject({ status: 'error' })
    }
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

})
