import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type BrowserContext } from '@playwright/test'

const localOnly = Boolean(process.env.AUTH_E2E_MAIL_URL)
test.skip(!localOnly, 'Run with playwright.auth.config.ts against local Supabase and Inbucket only.')

const users = new Set<string>()
function authClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local Supabase is required.')
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  return { publicClient: createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options), secret: createClient(url, process.env.SUPABASE_SECRET_KEY!, options) }
}

async function credential(email = `auth-e2e-${randomUUID()}@example.test`) {
  const { secret } = authClients()
  const { data, error } = await secret.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.properties?.hashed_token || !data.user) throw new Error('Local Auth could not generate a test credential.')
  users.add(data.user.id)
  return { email, hash: data.properties.hashed_token, otp: data.properties.email_otp, user: data.user }
}

async function verify(context: BrowserContext, token_hash: string, baseURL: string, flow = 'confirm-email') {
  const nonceResponse = await context.request.get('/api/auth/verify')
  const { csrf } = await nonceResponse.json()
  return context.request.post('/api/auth/verify', {
    headers: { Origin: baseURL }, data: { mode: 'link', flow, token_hash, csrf },
  })
}

test.afterEach(async () => {
  if (!localOnly) return
  const { secret } = authClients()
  for (const id of users) {
    const { error } = await secret.auth.admin.deleteUser(id)
    if (error) throw new Error('Local Auth test-user cleanup failed.')
  }
  users.clear()
})

test('GET, HEAD, hydration and prefetch preserve the real credential; click writes cookies and navigates', async ({ page, context, baseURL }) => {
  const link = await credential()
  const calls: string[] = []
  page.on('request', (request) => { if (request.url().includes('/api/auth/verify')) calls.push(request.method()) })
  const get = await context.request.get('/auth/confirm')
  expect(get.headers()['cache-control']).toContain('no-store')
  expect(get.headers()['referrer-policy']).toBe('no-referrer')
  expect(get.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  await context.request.head('/auth/confirm')
  await context.request.get('/auth/confirm', { headers: { 'Next-Router-Prefetch': '1', Purpose: 'prefetch' } })
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=confirm-email`)
  await expect(page).toHaveURL(`${baseURL}/auth/confirm`)
  await expect(page.getByRole('button', { name: 'Confirm email address', exact: true })).toBeEnabled()
  expect(calls.filter((method) => method === 'POST')).toHaveLength(0)
  expect((await page.locator('body').textContent())?.includes(link.hash)).toBe(false)
  await page.getByRole('button', { name: 'Confirm email address', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/auth/confirmed`)
  await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies.some((cookie) => /^sb-.*-auth-token/.test(cookie.name))).toBe(true)
  expect(calls.filter((method) => method === 'POST')).toHaveLength(1)
  const replay = await verify(context, link.hash, baseURL!)
  expect(replay.status()).toBe(400)
  expect(await replay.json()).toEqual({ status: 'invalid_or_expired' })
})

test('first-account confirmation verifies a credential delivered to local Mailpit in another browser', async ({ page, baseURL }) => {
  const email = `auth-e2e-${randomUUID()}@example.test`
  const { publicClient, secret } = authClients()
  const { data, error } = await publicClient.auth.signInWithOtp({ email })
  void data
  expect(error).toBeNull()
  const { data: listed, error: listError } = await secret.auth.admin.listUsers({ page: 1, perPage: 1000 })
  expect(listError).toBeNull()
  const created = listed.users.find((user) => user.email === email)
  if (!created) throw new Error('Local test user was not found for cleanup.')
  users.add(created.id)
  expect(created.email_confirmed_at).toBeFalsy()
  let hash = ''
  await expect.poll(async () => {
    const response = await fetch(`${process.env.AUTH_E2E_MAIL_URL}/api/v1/messages`)
    const { messages } = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] }
    const message = messages.find((item) => item.To.some((recipient) => recipient.Address === email))
    if (!message) return false
    const mail = await (await fetch(`${process.env.AUTH_E2E_MAIL_URL}/api/v1/message/${message.ID}`)).json() as { HTML: string; Text: string }
    // Local templates may still use ConfirmationURL. Extract the same TokenHash
    // that the new template places in a fragment, without opening the old URL.
    const match = `${mail.HTML}\n${mail.Text}`.match(/[?&#]token(?:_hash)?=([^&"\s<>]+)/)
    hash = match?.[1] ?? ''
    return Boolean(hash)
  }, { timeout: 15000 }).toBe(true)
  // Exchange only after a deliberate click, in the Playwright browser rather
  // than the Supabase client that requested the email (no PKCE verifier shared).
  await page.goto(`/auth/confirm#token_hash=${hash}&flow=confirm-email`)
  await page.getByRole('button', { name: 'Confirm email address', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/auth/confirmed`)
  await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible()
})

test('real numeric OTP accepts the correct mailbox and rejects a wrong code', async ({ page, context, baseURL }) => {
  const link = await credential()
  await page.goto('/auth/confirm')
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('confirm-email')
  await page.getByLabel('Email', { exact: true }).fill(link.email)
  await page.getByLabel('Verification code', { exact: true }).fill(link.otp)
  await page.getByRole('button', { name: 'Confirm email address', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/auth/confirmed`)
  await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible()
  const second = await credential()
  const nonce = await (await context.request.get('/api/auth/verify')).json()
  const wrong = await context.request.post('/api/auth/verify', { headers: { Origin: baseURL! }, data: {
    mode: 'otp', flow: 'confirm-email', csrf: nonce.csrf, email: second.email, token: '0'.repeat(second.otp.length),
  } })
  expect(wrong.status()).toBe(400)
  expect(await wrong.json()).toEqual({ status: 'invalid_or_expired' })
})

test('verified unauthorized users cannot access administration', async ({ page, baseURL }) => {
  const link = await credential()
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=admin-signin`)
  await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
  await expect(page.locator('.form-status[role="alert"]')).toContainText('not authorized')
  await page.goto('/admin')
  await expect(page).toHaveURL(`${baseURL}/admin/login?error=not_authorized`)
})

test('authorized user receives a real session and reaches the protected Dashboard', async ({ page, baseURL }) => {
  const link = await credential('auth-e2e-admin@example.test')
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=admin-signin`)
  await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/admin`)
  await expect(page.getByRole('heading', { name: 'Community operations', exact: true })).toBeVisible()
})

test('refresh loses the in-memory token; query credentials and duplicate fragment fields fall back to OTP', async ({ page }) => {
  const link = await credential()
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=confirm-email`)
  await expect(page.getByText('Your one-time email link is ready.', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible()
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=confirm-email&flow=admin-signin`)
  await expect(page.locator('.form-status[role="alert"]')).toContainText('could not be read')
  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 })
})

test('two tabs retain independent memory and reuse a nonce; only one can consume the real token', async ({ page, context, baseURL }) => {
  const link = await credential()
  const other = await context.newPage()
  for (const tab of [page, other]) {
    await tab.goto(`/auth/confirm#token_hash=${link.hash}&flow=confirm-email`)
    await expect(tab.getByRole('button', { name: 'Confirm email address', exact: true })).toBeEnabled()
  }
  await page.getByRole('button', { name: 'Confirm email address', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/auth/confirmed`)
  await other.getByRole('button', { name: 'Confirm email address', exact: true }).click()
  await expect(other.locator('.form-status[role="alert"]')).toContainText('invalid, expired, or already used')
})

test('a missing session cannot claim confirmation through query parameters; JavaScript-off users get guidance', async ({ page, browser, baseURL }) => {
  await page.goto('/auth/confirmed?status=verified&email_confirmed=true')
  await expect(page.getByRole('heading', { name: 'Confirm your email to continue' })).toBeVisible()
  const context = await browser.newContext({ javaScriptEnabled: false })
  const noJs = await context.newPage()
  await noJs.goto(`${baseURL}/auth/confirm#token_hash=not-a-real-token&flow=confirm-email`)
  await expect(noJs.locator('noscript p')).toBeVisible()
  await expect(noJs.locator('noscript p')).toContainText('JavaScript is required')
  await context.close()
})

test('an uncertain response stops retrying, while a rate-limited response shows Retry-After', async ({ page }) => {
  let calls = 0
  await page.route('**/api/auth/verify', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    calls++
    await route.fulfill({ status: 503, json: { status: 'temporarily_unavailable' } })
  })
  await page.goto('/auth/confirm#token_hash=test-only-placeholder&flow=admin-signin')
  await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
  await expect(page.locator('.form-status[role="alert"]')).toContainText('could not confirm the result')
  await expect(page.getByRole('button', { name: 'Confirm sign-in', exact: true })).toBeDisabled()
  expect(calls).toBe(1)
  await page.unroute('**/api/auth/verify')
  await page.route('**/api/auth/verify', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 429, headers: { 'Retry-After': '42' }, json: { status: 'rate_limited' } })
  })
  await page.goto('/auth/confirm#token_hash=another-test-placeholder&flow=admin-signin')
  await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
  await expect(page.locator('.form-status[role="alert"]')).toContainText('42 seconds')
})

test('simultaneous form submissions produce one POST and a network failure has a recovery path', async ({ page }) => {
  let calls = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/auth/verify', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    calls++
    await gate
    await route.abort('failed')
  })
  await page.goto('/auth/confirm#token_hash=test-only-placeholder&flow=admin-signin')
  await expect(page.getByRole('button', { name: 'Confirm sign-in', exact: true })).toBeEnabled()
  await page.locator('form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit() })
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('button', { name: 'Confirming…', exact: true })).toBeDisabled()
  release!()
  await expect(page.locator('.form-status[role="alert"]')).toContainText('code may already have been used')
  await expect(page.getByRole('link', { name: 'Check your email confirmation session' })).toBeVisible()
  expect(calls).toBe(1)
})
