import { expect, test } from '@playwright/test'

const institutionalRoutes = [
  { path: '/', heading: /AI Agents should enlarge human possibility/, title: 'Rein Protocol Foundation' },
  { path: '/mission', heading: 'Build benefit. Prevent catastrophe.', title: 'Mission' },
  { path: '/programs', heading: 'Knowledge becomes public capacity.', title: 'Programs and Public Work' },
  { path: '/governance', heading: 'Power should leave a record.', title: 'Governance and Stewardship' },
  { path: '/giving', heading: 'Native to the Agent economy. Bound to charitable law.', title: 'Giving Architecture' },
] as const

test.describe('institutional site', () => {
  for (const route of institutionalRoutes) {
    test(`${route.path} keeps its public route and metadata`, async ({ page }) => {
      await page.goto(route.path)
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()
      await expect(page).toHaveTitle(new RegExp(route.title))
      await expect(page.locator('main#main-content')).toBeVisible()
    })
  }

  test('home remains Mission-first while exposing Community', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Read our mission' })).toHaveAttribute('href', '/mission')
    await expect(page.getByRole('heading', { name: /A public network of/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Enter the community' })).toHaveAttribute('href', '/community')
    await expect(page.getByText('Registered. Operational. Accountable.')).toBeVisible()
    await expect(page.getByText(/not active|not ready|pre-launch|in formation/i)).toHaveCount(0)
  })

  test('mobile navigation opens, closes, and preserves route links', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    const toggle = page.locator('.menu-toggle')
    await toggle.click()
    await expect(page.getByLabel('Primary navigation').getByRole('link', { name: 'Community', exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('Community has its own landscape artwork', async ({ page }) => {
    await page.goto('/community')
    const communityImage = page.locator('.community-hero__figure img')
    await expect(communityImage).toHaveAttribute('src', /community-convergence/)
    const source = await communityImage.getAttribute('src')
    const dimensions = await communityImage.evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }))
    expect(dimensions.width / dimensions.height).toBeCloseTo(5 / 3, 1)

    await page.goto('/governance')
    await expect(page.locator('.article-hero__figure img')).not.toHaveAttribute('src', source!)
  })

  test('keyboard users reach the skip link first', async ({ page }) => {
    await page.goto('/community')
    await page.getByRole('navigation', { name: 'Community navigation' }).waitFor()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  })
})
