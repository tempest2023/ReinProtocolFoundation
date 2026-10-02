import { expect, test } from '@playwright/test'
import {
  communityNavigation,
  communityNavigationLabels,
  expectHeadingBelowStickyHeader,
} from './support/community'

test.describe('Community overview and navigation', () => {
  test('overview presents every participation path without launch-state copy', async ({ page }) => {
    await page.goto('/community')
    await expect(page.getByRole('heading', { level: 1, name: /A community of/ })).toBeVisible()
    for (const heading of [
      'Start with a conversation, a resource, or an event.',
      'Meet in person. Stay connected online.',
      'People behind the work.',
      'Register for community updates.',
      'Choose how you want to contribute.',
    ]) await expect(page.getByRole('heading', { name: heading })).toBeVisible()

    await expect(page.getByText(/being prepared|being planned|not open yet|check back soon/i)).toHaveCount(0)
    await expect(page.locator('.member-measure')).toHaveCount(0)
  })

  test('header submenu uses the five single-word labels', async ({ page }) => {
    await page.goto('/community/contribute/apply')
    const navigation = communityNavigation(page)

    for (const label of communityNavigationLabels) {
      await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    for (const retiredLabel of ['Learn', 'Gather', 'Apply', 'Submit resource', 'Code of Conduct']) {
      await expect(navigation.getByRole('link', { name: retiredLabel, exact: true })).toHaveCount(0)
    }
    await expect(navigation.getByRole('link', { name: 'Contribute' })).toHaveAttribute('aria-current', 'location')
  })

  for (const item of [
    { label: 'Program', hash: '#program', heading: 'Meet in person. Stay connected online.' },
    { label: 'People', hash: '#people', heading: 'People behind the work.' },
    { label: 'Connect', hash: '#register', heading: 'Register for community updates.' },
    { label: 'Contribute', hash: '#contribute', heading: 'Choose how you want to contribute.' },
  ] as const) {
    test(`${item.label} selects its section without hiding the heading`, async ({ page }) => {
      await page.goto('/community')
      const link = communityNavigation(page).getByRole('link', { name: item.label, exact: true })
      await link.click()

      await expect(page).toHaveURL(new RegExp(`${item.hash}$`))
      await expect(link).toHaveAttribute('aria-current', 'location')
      await expectHeadingBelowStickyHeader(page, item.heading)
    })
  }

  for (const redirect of [
    { path: '/community/learn', hash: '#program', heading: 'Online community and learning.' },
    { path: '/community/gather', hash: '#program', heading: 'In-person events.' },
    { path: '/community/people', hash: '#people', heading: 'People behind the work.' },
  ] as const) {
    test(`${redirect.path} preserves its URL through a section redirect`, async ({ page }) => {
      await page.goto(redirect.path)
      await expect(page).toHaveURL(new RegExp(`/community${redirect.hash}$`))
      await expect(page.getByRole('heading', { name: redirect.heading })).toBeVisible()
    })
  }
})

test.describe('Community contribution and policies', () => {
  test('Program offers resource and event submission actions', async ({ page }) => {
    await page.goto('/community#program')
    await expect(page.getByRole('link', { name: 'Submit a learning resource' })).toHaveAttribute('href', '/community/contribute/resources/submit')
    await expect(page.getByRole('link', { name: 'Propose an event on GitHub' })).toHaveAttribute('href', /github\.com/)
  })

  test('Contribute offers private, GitHub, and learning-resource paths', async ({ page }) => {
    await page.goto('/community/contribute')
    await expect(page.getByRole('link', { name: 'Apply privately' })).toHaveAttribute('href', '/community/contribute/apply')
    await expect(page.getByRole('link', { name: 'Submit a resource' })).toHaveAttribute('href', '/community/contribute/resources/submit')
    for (const label of ['Event proposal', 'Campus volunteer', 'Technical contribution']) {
      await expect(page.getByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', /github\.com/)
    }
    await expect(page.getByText('GitHub submissions are public.')).toBeVisible()
    await expect(page.getByText(/Do not include private contact details, addresses/i)).toBeVisible()
  })

  test('Code of Conduct publishes concrete safety boundaries', async ({ page }) => {
    await page.goto('/community/code-of-conduct')
    await expect(page.getByRole('heading', { level: 1, name: 'Code of Conduct' })).toBeVisible()
    await expect(page.getByText(/Explicit threats or encouragement of violence/)).toBeVisible()
    await expect(page.getByText(/Ordinary disagreement, criticism of the Mission/)).toBeVisible()
  })

  test('Privacy Policy documents collection, AI processing, and retention', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible()
    await expect(page.getByText(/IP address/).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AI-assisted processing' })).toBeVisible()
    await expect(page.getByText(/deleted within seven days/)).toBeVisible()
  })

  test('verification result handles success and invalid links', async ({ page }) => {
    await page.goto('/community/contribute/apply/verified?status=success')
    await expect(page.getByRole('heading', { name: 'Your email is verified.' })).toBeVisible()

    await page.goto('/community/contribute/apply/verified?status=invalid')
    await expect(page.getByRole('heading', { name: 'This verification link is not valid.' })).toBeVisible()
  })
})
