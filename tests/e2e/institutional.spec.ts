import { expect, test } from '@playwright/test'

const institutionalRoutes = [
  { path: '/', heading: 'Making AI agents safer for people and society.', title: 'Rein Protocol Foundation' },
  { path: '/mission', heading: 'Making AI agents safer for people and society.', title: 'Mission' },
  { path: '/programs', heading: 'Meet in person. Keep learning together online.', title: 'Programs and Public Work' },
  { path: '/governance', heading: 'AI agents help run Rein. People remain responsible.', title: 'Governance and Stewardship' },
  { path: '/giving', heading: 'Support AI agent safety and community.', title: 'Giving' },
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

  test('home hero communicates the nonprofit mission and work', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.home-hero .eyebrow')).toHaveText('A NONPROFIT ORGANIZATION FOR AI AGENT SAFETY')
    await expect(page.locator('#home-title')).toHaveText('Making AI agents safer for people and society.')
    await expect(page.locator('.home-hero__mission')).toHaveText('We bring people together and support open-source projects and research to make AI agents safer.')
  })

  test('page titles inherit the shared leading token', async ({ page }) => {
    for (const path of ['/', '/mission', '/community']) {
      await page.goto(path)
      const heading = page.getByRole('heading', { level: 1 })
      await expect(heading).toBeVisible()

      const metrics = await heading.evaluate(element => {
        const style = getComputedStyle(element)
        return {
          leading: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
          token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--type-page-title-leading')),
        }
      })
      expect(metrics.token).toBeGreaterThanOrEqual(1.1)
      expect(metrics.leading).toBeCloseTo(metrics.token, 4)

      const updatedLeading = metrics.token + 0.15
      await page.evaluate(value => {
        document.documentElement.style.setProperty('--type-page-title-leading', String(value))
      }, updatedLeading)
      await expect.poll(() => heading.evaluate(element => {
        const style = getComputedStyle(element)
        return parseFloat(style.lineHeight) / parseFloat(style.fontSize)
      })).toBeCloseTo(updatedLeading, 4)
    }
  })

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
