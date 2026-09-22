import { expect, test } from '@playwright/test'
import { directAdminEmail, signInDevelopmentAdmin } from './support/admin'

test.describe('administration access boundary', () => {
  test('unauthenticated dashboard requests return to login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
    await expect(page.getByRole('heading', { level: 1, name: 'Rein Dashboard' })).toBeVisible()
  })

  test('admin pages are excluded from search indexing', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  test('login exposes controlled access without public registration', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(page.getByText(/There is no public administrator registration|Development mode/)).toBeVisible()

    const email = page.getByRole('textbox', { name: 'Email' })
    if (await email.count()) {
      await expect(email).toHaveAttribute('type', 'email')
      await expect(page.getByRole('button', { name: /Sign in|Send magic link/ })).toBeEnabled()
      await email.fill('admin@example')
      await page.getByRole('button', { name: /Sign in|Send magic link/ }).click()
      await expect(page.locator('.form-status[role="alert"]')).toContainText('Enter a valid administrator email.')
    } else {
      await expect(page.getByText('Administrative access is environment-controlled.')).toBeVisible()
    }
  })
})

test.describe('authenticated administration smoke test', () => {
  test('authorized development admin can open every Dashboard module', async ({ page }) => {
    test.skip(!directAdminEmail, 'Set ADMIN_EMAILS and leave RESEND_API_KEY empty to run the local authenticated Dashboard smoke test.')
    await signInDevelopmentAdmin(page, directAdminEmail!)

    for (const module of [
      { path: '/admin', heading: 'Community operations' },
      { path: '/admin/participants', heading: 'Participants' },
      { path: '/admin/applications', heading: 'Applications' },
      { path: '/admin/contributors', heading: 'Contributors' },
      { path: '/admin/people', heading: 'People' },
      { path: '/admin/learn', heading: 'Learn' },
      { path: '/admin/gather', heading: 'Gather' },
      { path: '/admin/resources', heading: 'Review' },
      { path: '/admin/guide/contributor-conversation', heading: 'Contributor Conversation' },
      { path: '/admin/settings', heading: 'Settings' },
      { path: '/admin/audit-log', heading: 'Audit' },
    ]) {
      await page.goto(module.path)
      await expect(page.getByRole('heading', { level: 1, name: module.heading })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible()
    }
  })
})
