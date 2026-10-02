import { expect, test } from '@playwright/test'
import { selectInternationalLocation, selectUnitedStatesLocation } from './support/community'

test.describe('Community Participant registration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/community#register')
  })

  test('is compact, enabled, and free of pre-launch warnings', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const form = page.locator('.community-form--participant')
    await expect(form).toBeVisible()
    await expect(form.getByText(/not open|not ready|check back soon/i)).toHaveCount(0)
    await expect(form.getByRole('button', { name: 'Register for community updates' })).toBeEnabled()

    const box = await form.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeLessThanOrEqual(1088)
    expect(box!.height).toBeLessThanOrEqual(650)
  })

  test('validates required fields without contacting external services', async ({ page }) => {
    const form = page.locator('.community-form--participant')
    await form.getByRole('button', { name: 'Register for community updates' }).click()
    await expect(form.getByRole('alert')).toContainText('Review the highlighted fields.')
    await expect(form.locator('#email-error')).toHaveText('Enter a valid email address.')
  })

  test('switches between US and international location fields', async ({ page }) => {
    const form = page.locator('.community-form--participant')
    await expect(form.getByRole('switch', { name: 'Outside the United States' })).toHaveAttribute('aria-checked', 'false')
    await selectInternationalLocation(form)
    await expect(form.getByRole('switch', { name: 'Outside the United States' })).toHaveAttribute('aria-checked', 'true')
    await expect(form.getByLabel(/^Country/)).toHaveValue('Canada')
    await expect(form.getByLabel(/^State/)).toHaveCount(0)

    await selectUnitedStatesLocation(form)
    await expect(form.getByLabel(/^State/)).toHaveValue('CA')
    await expect(form.getByLabel(/^Country/)).toHaveCount(0)
  })

  test('reveals a field when industry is Other', async ({ page }) => {
    const form = page.locator('.community-form--participant')
    await form.getByLabel(/^Field or industry/).selectOption('Other')
    await expect(form.getByLabel(/^Your field or industry/)).toBeVisible()
  })
})

test.describe('Contributor application', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/community/contribute/apply')
  })

  test('sets a low-pressure, 30-minute conversation expectation', async ({ page }) => {
    await expect(page.getByText(/Most public resources and events are open to everyone/)).toBeVisible()
    await expect(page.getByText('A conversation, not an interview.')).toBeVisible()
    await expect(page.getByText(/up to 30 minutes/)).toBeVisible()
    await expect(page.getByText(/monthly/i)).toHaveCount(0)
  })

  test('includes all optional professional links and profile preference', async ({ page }) => {
    const form = page.locator('form.community-form')
    for (const label of ['Personal website', 'GitHub', 'Google Scholar', 'LinkedIn']) {
      await expect(form.getByRole('textbox', { name: label })).toBeVisible()
    }
    for (const preference of ['Yes, if invited', 'Not at this time', 'Prefer to discuss later']) {
      await expect(form.getByLabel(preference)).toBeVisible()
    }
    await expect(form.getByText(/separate consent before publishing/)).toBeVisible()
  })

  test('reveals free-text fields only when Other is selected', async ({ page }) => {
    const form = page.locator('form.community-form')
    const reasons = form.getByRole('group', { name: /Why do you want to participate/ })
    const contributions = form.getByRole('group', { name: /What would you like to contribute/ })

    await reasons.getByLabel('Other').check()
    await contributions.getByLabel('Other').check()
    await expect(form.getByRole('textbox', { name: 'Other reason' })).toBeVisible()
    await expect(form.getByRole('textbox', { name: 'Other contribution' })).toBeVisible()
  })

  test('supports international applicants without requesting a street address', async ({ page }) => {
    const form = page.locator('form.community-form')
    await selectInternationalLocation(form, 'Spain', 'Madrid')
    await expect(form.getByLabel(/^Country/)).toHaveValue('Spain')
    await expect(form.getByText('Do not enter a street address.')).toHaveCount(0)
    await expect(form.getByLabel(/Street/)).toHaveCount(0)
  })

  test('validates the required application fields inline', async ({ page }) => {
    const form = page.locator('form.community-form')
    await form.getByRole('button', { name: 'Submit Contributor application' }).click()
    await expect(form.getByRole('alert')).toContainText('Review the highlighted fields.')
    await expect(form.locator('#name-error')).toBeVisible()
    await expect(form.locator('#participation_reasons-error')).toBeVisible()
    await expect(form.locator('#contribution_areas-error')).toBeVisible()
  })
})

test.describe('Learning-resource submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/community/contribute/resources/submit')
  })

  test('uses a single concise description and material category', async ({ page }) => {
    const form = page.locator('form.community-form')
    await expect(form.getByRole('combobox', { name: /Material type/ })).toHaveValue('')
    for (const type of ['Video', 'Article / Document', 'Course', 'Paper Discussion', 'Tool / Reference']) {
      await expect(form.getByRole('option', { name: type, exact: true })).toBeAttached()
    }
    await expect(form.getByRole('textbox', { name: /^Language/ })).toHaveAttribute('placeholder', 'e.g. English, 中文, Spanish')
    const description = form.getByRole('textbox', { name: /^Description/ })
    await expect(description).toHaveAttribute('maxlength', '1000')
    await expect(description).toHaveAttribute('placeholder', /what members can learn about AI agents/)
    await expect(form.getByRole('textbox', { name: /How is this relevant/ })).toHaveCount(0)
  })

  test('accepts public URLs only and never requests an upload', async ({ page }) => {
    const form = page.locator('form.community-form')
    await expect(form.getByRole('textbox', { name: /^Public URL/ })).toHaveAttribute('type', 'url')
    await expect(form.getByText('Public links only. File uploads are not accepted.')).toBeVisible()
    await expect(form.locator('input[type="file"]')).toHaveCount(0)
  })

  test('keeps submitter identity private from published resources', async ({ page }) => {
    await expect(page.getByText('Your identity stays private.')).toBeVisible()
    await expect(page.getByText(/the community resource list will show the resource’s author or publisher, not the submitter/)).toBeVisible()
  })

  test('validates required resource fields inline', async ({ page }) => {
    const form = page.locator('form.community-form')
    await form.getByRole('button', { name: 'Submit resource for review' }).click()
    await expect(form.getByRole('alert')).toContainText('Review the highlighted fields.')
    await expect(form.locator('#contact_email-error')).toBeVisible()
    await expect(form.locator('#description-error')).toBeVisible()
  })
})
