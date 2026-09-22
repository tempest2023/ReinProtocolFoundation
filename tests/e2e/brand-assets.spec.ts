import { expect, test } from '@playwright/test'

test('approved brand assets and device icon metadata resolve correctly', async ({ page, request }) => {
  await page.goto('/')
  for (const selector of [
    'link[rel="icon"][href^="/favicon.ico"]',
    'link[rel="icon"][href^="/icon.svg"]',
    'link[rel="icon"][href^="/icon1.png"]',
    'link[rel="apple-touch-icon"][href^="/apple-icon.png"]',
  ]) {
    const link = page.locator(selector)
    await expect(link).toHaveCount(1)
    const response = await request.get((await link.getAttribute('href'))!)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/^image\//)
  }

  const manifestLink = page.locator('link[rel="manifest"]')
  await expect(manifestLink).toHaveAttribute('href', '/site.webmanifest')
  const manifest = await (await request.get('/site.webmanifest')).json()
  expect(manifest.name).toBe('Rein Protocol Foundation')
  expect(manifest.start_url).toBe('/')
  for (const icon of manifest.icons) {
    expect(icon.src).not.toContain('/favicon.ico/')
    expect((await request.get(icon.src)).status()).toBe(200)
  }

  for (const variant of ['header', 'footer']) {
    const mark = page.locator(`.foundation-mark--${variant}:visible`)
    await expect(mark).toHaveAttribute('src', `/brand/rein-mark-${variant}.png`)
    await expect.poll(() => mark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  }
})
