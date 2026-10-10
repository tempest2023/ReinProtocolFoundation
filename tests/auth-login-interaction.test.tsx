import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminLoginForm } from '@/app/admin/login/login-form'
import { EmailVerificationForm } from '@/app/auth/confirm/verification-form'
import { CodeSignInForm } from '@/components/auth/code-sign-in-form'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/app/admin/login/actions', () => ({ requestAdminLink: mocks.send }))
vi.mock('@/app/admin/locale-actions', () => ({ setAdminLanguage: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/admin/login')
  mocks.send.mockImplementation(async (_previous, form: FormData) => ({ status: 'success', email: form.get('email'), method: form.get('method'), retryAt: Date.now() + 60000, message: 'If this address is authorized, a sign-in link has been sent.' }))
})
afterEach(() => vi.unstubAllGlobals())

it('replaces the email form with directions after sending a link', async () => {
  render(<AdminLoginForm />)
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.org' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
  await screen.findByRole('heading', { name: 'Check your email' })
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Send magic link' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Change email or sign-in method' }))
  expect(screen.getByLabelText('Email')).toBeVisible()
})

it('immediately shows the code input after requesting a code', async () => {
  render(<AdminLoginForm />)
  fireEvent.click(screen.getByRole('button', { name: 'Verification code' }))
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.org' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }))
  await screen.findByLabelText('Verification code')
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Sign-in method' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

it('automatically exchanges a link once under Strict Mode and removes its fragment', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrf: 'nonce' }))).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'invalid_or_expired' }), { status: 400 }))
  vi.stubGlobal('fetch', fetch)
  window.history.replaceState({}, '', '/auth/confirm#token_hash=test-token&flow=admin-signin')
  render(<StrictMode><EmailVerificationForm /></StrictMode>)
  await screen.findByRole('alert')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][1].method).toBe('POST')
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ mode: 'link', token_hash: 'test-token' })
  expect(window.location.hash).toBe('')
  expect(screen.queryByRole('button', { name: 'Confirm sign-in' })).not.toBeInTheDocument()
})

it('gets a fresh nonce for each deliberate code submission and permits correcting a wrong code', async () => {
  const fetch = vi.fn().mockImplementation(async (_url, options) => new Response(JSON.stringify(options.method === 'POST' ? { status: 'invalid_or_expired' } : { csrf: 'fresh-nonce' }), { status: options.method === 'POST' ? 400 : 200 }))
  vi.stubGlobal('fetch', fetch)
  render(<CodeSignInForm email="admin@example.org" />)
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '00000000' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
  await screen.findByRole('alert')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
  expect(fetch.mock.calls.filter((c) => c[1].method === 'POST')).toHaveLength(2)
})
