import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type BrowserContext } from '@playwright/test'

const localOnly = Boolean(process.env.AUTH_E2E_MAIL_URL)
test.skip(!localOnly, 'Run against local Supabase and a local mail catcher only.')
const adminEmail = 'auth-e2e-admin@example.test'
const users = new Set<string>()
function authClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local Auth is required.')
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  return { publicClient: createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options), secret: createClient(url, process.env.SUPABASE_SECRET_KEY!, options) }
}
async function credential(email = `auth-e2e-${randomUUID()}@example.test`) {
  const { data, error } = await authClients().secret.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.properties || !data.user) throw new Error('Local test credential unavailable.')
  users.add(data.user.id)
  return { email, hash: data.properties.hashed_token, otp: data.properties.email_otp, user: data.user }
}
async function verify(context: BrowserContext, token_hash: string, origin: string, flow = 'confirm-email') {
  const { csrf } = await (await context.request.get('/api/auth/verify')).json()
  return context.request.post('/api/auth/verify', { headers: { Origin: origin }, data: { mode: 'link', flow, token_hash, csrf } })
}
async function received(email: string, since: number) {
  let html = ''; let subject = ''
  await expect.poll(async () => {
    const { messages } = await (await fetch(`${process.env.AUTH_E2E_MAIL_URL}/api/v1/messages`)).json()
    const message = messages.find((m: { Created: string; To: { Address: string }[] }) => Date.parse(m.Created) >= since && m.To.some(r => r.Address === email))
    if (!message) return false
    const mail = await (await fetch(`${process.env.AUTH_E2E_MAIL_URL}/api/v1/message/${message.ID}`)).json()
    html = mail.HTML; subject = mail.Subject
    return Boolean(html)
  }, { timeout: 15000 }).toBe(true)
  const { data } = await authClients().secret.auth.admin.listUsers({ perPage: 1000 })
  const created = data.users.find(u => u.email === email)
  if (created) users.add(created.id)
  return { html, subject }
}

test.beforeEach(async () => {
  if (!localOnly) return
  // Local-only fixture counters; keep production limit behavior independently tested.
  const { error } = await authClients().secret.from('dev_form_rate_limits').delete().like('form_type', 'auth_%')
  if (error) throw new Error('Local Auth limiter fixture reset failed.')
})
test.afterEach(async () => {
  if (!localOnly) return
  for (const id of users) {
    const { error } = await authClients().secret.auth.admin.deleteUser(id)
    if (error) throw new Error('Local Auth test-user cleanup failed.')
  }
  users.clear()
})

test('GET, HEAD and prefetch preserve the token; hydration automatically signs in once', async ({ page, context, baseURL }) => {
  const link = await credential()
  const get = await context.request.get('/auth/confirm')
  expect(get.headers()['cache-control']).toContain('no-store')
  expect(get.headers()['referrer-policy']).toBe('no-referrer')
  expect(get.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  await context.request.head('/auth/confirm')
  await context.request.get('/auth/confirm', { headers: { 'Next-Router-Prefetch': '1', Purpose: 'prefetch' } })
  let calls = 0; let leaked = false
  page.on('request', r => { if (r.url().includes('/api/auth/verify') && r.method() === 'POST') calls++; if (r.url().includes(link.hash)) leaked = true })
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=confirm-email`)
  await expect(page).toHaveURL(`${baseURL}/auth/confirmed`)
  await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible()
  expect(calls).toBe(1); expect(leaked).toBe(false)
  expect((await context.cookies()).some(c => c.name.includes('auth-token'))).toBe(true)
  const replay = await verify(context, link.hash, baseURL!)
  expect(replay.status()).toBe(400)
  expect(await replay.json()).toEqual({ status: 'invalid_or_expired' })
})

test('administrator persists across browser reopening and Sign Out ends only the current session', async ({ browser, baseURL }) => {
  const original = await browser.newContext()
  const link = await credential(adminEmail)
  expect((await verify(original, link.hash, baseURL!, 'admin-signin')).ok()).toBe(true)
  const authCookies = (await original.cookies()).filter(c => c.name.includes('auth-token'))
  expect(authCookies.length).toBeGreaterThan(0)
  for (const cookie of authCookies) expect(cookie.expires - Date.now() / 1000).toBeCloseTo(30 * 86400, -1)
  const stored = await original.storageState()
  await original.close()
  const reopened = await browser.newContext({ storageState: stored })
  const page = await reopened.newPage()
  await page.goto('/admin/login')
  await expect(page).toHaveURL(`${baseURL}/admin`)

  // Age only client-side expiry metadata; keep the signed JWT and refresh token intact.
  // This exercises the real proxy/GoTrue refresh path without waiting an hour.
  const persisted = (await reopened.cookies()).filter(c => c.name.includes('auth-token')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const session = JSON.parse(Buffer.from(persisted.map(c => c.value).join('').slice(7), 'base64url').toString())
  const previousRefreshToken = session.refresh_token
  session.expires_at = Math.floor(Date.now() / 1000) - 60
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  const stem = persisted[0].name.replace(/\.\d+$/, '')
  await reopened.clearCookies({ name: /auth-token/ })
  const chunks = []
  for (let offset = 0; offset < encoded.length; offset += 3000) {
    const { name: _name, value: _value, ...attributes } = persisted[0]
    chunks.push({ ...attributes, name: encoded.length > 3000 ? `${stem}.${chunks.length}` : stem, value: encoded.slice(offset, offset + 3000) })
  }
  await reopened.addCookies(chunks)
  await page.goto('/admin')
  await expect(page).toHaveURL(`${baseURL}/admin`)
  const refreshed = (await reopened.cookies()).filter(c => c.name.includes('auth-token')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  expect(JSON.parse(Buffer.from(refreshed.map(c => c.value).join('').slice(7), 'base64url').toString()).refresh_token).not.toBe(previousRefreshToken)
  for (const cookie of refreshed) expect(cookie.expires - Date.now() / 1000).toBeCloseTo(30 * 86400, -1)

  const second = await browser.newContext()
  const secondLink = await credential(adminEmail)
  expect((await verify(second, secondLink.hash, baseURL!, 'admin-signin')).ok()).toBe(true)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/admin/login`)
  expect((await reopened.cookies()).filter(c => c.name.includes('auth-token'))).toHaveLength(0)
  await page.goto('/admin')
  await expect(page).toHaveURL(`${baseURL}/admin/login`)
  const otherPage = await second.newPage()
  await otherPage.goto('/admin')
  await expect(otherPage.getByRole('heading', { name: 'Community operations', exact: true })).toBeVisible()
  await reopened.close()
  await second.close()
})

for (const existing of [false, true]) {
  test(`${existing ? 'existing' : 'first'} administrator receives a link-only email and signs in in a different browser`, async ({ page, browser, baseURL }, testInfo) => {
    if (existing) {
      const { data, error } = await authClients().secret.auth.admin.createUser({ email: adminEmail, email_confirm: true })
      expect(error).toBeNull(); users.add(data.user!.id)
    }
    const since = Date.now()
    await page.goto('/admin/login')
    await page.getByLabel('Email', { exact: true }).fill(adminEmail)
    await page.getByRole('button', { name: 'Send magic link', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send magic link', exact: true })).toHaveCount(0)
    if (testInfo.project.name === 'auth-chromium') {
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720)
      await page.screenshot({ path: testInfo.outputPath('email-sent.png') })
    }
    const mail = await received(adminEmail, since)
    expect(mail.subject).toBe('Your sign-in link — Rein Protocol Foundation')
    expect(mail.html).not.toMatch(/\b\d{8}\b/)
    expect(mail.html).not.toContain('/auth/code')
    expect(mail.html).toContain('valid for 2 hours')
    const link = mail.html.match(/href="([^"]*\/auth\/confirm#[^"]+)"/)?.[1].replaceAll('&amp;', '&')
    expect(link).toBeTruthy()
    const other = await browser.newContext()
    const landing = await other.newPage()
    await landing.goto(link!)
    await expect(landing).toHaveURL(`${baseURL}/admin`)
    await expect(landing.getByRole('heading', { name: 'Community operations', exact: true })).toBeVisible()
    await other.close()
  })
}

test('code email is separate and the sending page directly accepts it with a fresh nonce', async ({ page, context, baseURL }, testInfo) => {
  const since = Date.now()
  await page.goto('/admin/login')
  await page.getByRole('button', { name: 'Verification code', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill(adminEmail)
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click()
  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Sign-in method' })).toHaveCount(0)
  if (testInfo.project.name === 'auth-chromium') {
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720)
    await page.screenshot({ path: testInfo.outputPath('code-sent.png') })
  }
  const mail = await received(adminEmail, since)
  expect(mail.subject).toBe('Your sign-in code — Rein Protocol Foundation')
  expect(mail.html).not.toContain('token_hash=')
  expect(mail.html).not.toContain('Sign in to Rein →')
  const code = mail.html.match(/\b\d{8}\b/)?.[0]
  expect(code).toBeTruthy()
  // An expired nonce must not strand users who took time to retrieve the email.
  await context.addCookies([{ name: 'rein-auth-csrf', value: '1000000000000.' + 'a'.repeat(64), url: baseURL! }])
  await page.getByLabel('Verification code', { exact: true }).fill(code!)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/admin`)
  const { csrf } = await (await context.request.get('/api/auth/verify')).json()
  const replay = await context.request.post('/api/auth/verify', { headers: { Origin: baseURL! }, data: { mode: 'otp', flow: 'admin-signin', email: adminEmail, token: code, csrf } })
  expect(replay.status()).toBe(400)
  expect(await replay.json()).toEqual({ status: 'invalid_or_expired' })
  await page.goto('/auth/confirmed')
  await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible()
})

test('code entry supports another device and correcting a wrong code', async ({ page, baseURL }) => {
  const link = await credential(adminEmail)
  await page.goto('/auth/code')
  await expect(page.getByRole('combobox', { name: 'Action' })).toHaveCount(0)
  await page.getByLabel('Email', { exact: true }).fill(link.email)
  await page.getByLabel('Verification code', { exact: true }).fill('0'.repeat(link.otp.length))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.form-status[role=alert]')).toContainText('invalid, expired, or already used')
  await page.getByLabel('Verification code', { exact: true }).fill(link.otp)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/admin`)
})

test('verified unauthorized users cannot access administration', async ({ page, baseURL }) => {
  const link = await credential()
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=admin-signin`)
  await expect(page.locator('.form-status[role=alert]')).toContainText('does not have administrator access')
  await page.goto('/admin')
  await expect(page).toHaveURL(`${baseURL}/admin/login?error=not_authorized`)
})

test('missing links and duplicate fragment fields show one recovery path without storing credentials', async ({ page }) => {
  let calls = 0
  page.on('request', r => { if (r.url().includes('/api/auth/verify') && r.method() === 'POST') calls++ })
  for (const path of ['/auth/confirm', '/auth/confirm#token_hash=placeholder&flow=confirm-email&flow=admin-signin', '/auth/confirm?token_hash=placeholder']) {
    await page.goto(path)
    await expect(page.locator('.form-status[role=alert]')).toContainText('missing or incomplete')
    await expect(page.getByRole('link', { name: 'Request a new sign-in email' })).toBeVisible()
    await expect(page.getByLabel('Verification code')).toHaveCount(0)
  }
  expect(calls).toBe(0)
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, hash: location.hash, query: location.search }))).toEqual({ local: 0, session: 0, hash: '', query: '' })
})

test('two browsers cannot consume the same one-time credential', async ({ page, browser, baseURL }) => {
  const link = await credential()
  await page.goto(`/auth/confirm#token_hash=${link.hash}&flow=confirm-email`)
  await expect(page).toHaveURL(`${baseURL}/auth/confirmed`)
  const other = await browser.newContext()
  const replay = await other.newPage()
  await replay.goto(`${baseURL}/auth/confirm#token_hash=${link.hash}&flow=confirm-email`)
  await expect(replay.locator('.form-status[role=alert]')).toContainText('invalid, expired, or already used')
  expect((await other.cookies()).some(c => c.name.includes('auth-token'))).toBe(false)
  await other.close()
})

test('query assertions do not claim confirmation and JavaScript-off users get guidance', async ({ page, browser, baseURL }) => {
  await page.goto('/auth/confirmed?status=verified&email_confirmed=true')
  await expect(page.getByRole('heading', { name: 'Confirm your email to continue' })).toBeVisible()
  const context = await browser.newContext({ javaScriptEnabled: false })
  const noJs = await context.newPage()
  await noJs.goto(`${baseURL}/auth/confirm#token_hash=placeholder&flow=confirm-email`)
  await expect(noJs.locator('noscript p')).toContainText('JavaScript is required')
  await context.close()
})

test('uncertain and rate-limited results never retry automatically', async ({ page }) => {
  let calls = 0
  for (const status of [503, 429]) {
    await page.route('**/api/auth/verify', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      calls++
      await route.fulfill({ status, headers: { 'Retry-After': '42' }, json: { status: status === 503 ? 'temporarily_unavailable' : 'rate_limited' } })
    })
    await page.goto('/auth/confirm#token_hash=placeholder&flow=admin-signin')
    await expect(page.locator('.form-status[role=alert]')).toContainText(status === 503 ? 'could not confirm the result' : '42 seconds')
    await page.unroute('**/api/auth/verify')
  }
  expect(calls).toBe(2)
})

test('desktop authentication states fit a 720px viewport and language persists across auth routes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'auth-mobile', 'Desktop viewport acceptance.')
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const path of ['/admin/login', '/auth/code', '/auth/confirm']) {
    await page.goto(path)
    const panel = await page.locator('.admin-login__panel').boundingBox()
    expect(panel!.width).toBeGreaterThan(600)
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(720)
  }
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('zh')
  await expect(page.getByRole('heading', { name: '无法继续' })).toBeVisible()
  await page.goto('/auth/code')
  await expect(page.getByRole('heading', { name: '使用验证码登录' })).toBeVisible()
  await page.goto('/admin/login')
  await expect(page.getByRole('button', { name: '发送登录链接' })).toBeVisible()
})

test('credentials remain valid at 119 minutes and expire after 121 minutes', async ({ context, baseURL }) => {
  test.skip(!process.env.AUTH_E2E_DB_CONTAINER, 'Requires the explicit local database container for clock fixtures.')
  for (const minutes of [119, 121]) {
    const link = await credential()
    if (!/^[a-f0-9-]{36}$/.test(link.user.id)) throw new Error('Invalid local fixture UUID.')
    execFileSync('docker', ['exec', process.env.AUTH_E2E_DB_CONTAINER!, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `update auth.users set confirmation_sent_at=now()-interval '${minutes} minutes', recovery_sent_at=now()-interval '${minutes} minutes' where id='${link.user.id}'`], { stdio: 'pipe' })
    const response = await verify(context, link.hash, baseURL!)
    expect(response.status()).toBe(minutes === 119 ? 200 : 400)
  }
})
