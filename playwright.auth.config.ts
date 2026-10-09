import { defineConfig, devices } from '@playwright/test'

// Explicit, isolated local-only configuration. Never fall back to .env.local,
// which may point to the shared hosted project or a real SMTP provider.
if (process.env.AUTH_E2E_ENV_FILE) process.loadEnvFile(process.env.AUTH_E2E_ENV_FILE)
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'AUTH_E2E_MAIL_URL']
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required for local Auth E2E tests.`)
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'AUTH_E2E_MAIL_URL']) {
  const url = new URL(process.env[name]!)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Auth E2E tests require local Supabase and a local mail catcher.')
}
const port = process.env.AUTH_E2E_PORT ?? '3108'
const siteUrl = `http://127.0.0.1:${port}`
process.env.NEXT_PUBLIC_SITE_URL = siteUrl
process.env.AUTH_EMAIL_OTP_LENGTH ??= '8'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /auth-verification\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: siteUrl, trace: 'off' }, // Auth traces would contain bearer credentials.
  projects: [
    { name: 'auth-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'auth-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: siteUrl,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_SITE_URL: siteUrl,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!,
      DATABASE_ENVIRONMENT: 'dev', AUTH_EMAIL_OTP_LENGTH: process.env.AUTH_EMAIL_OTP_LENGTH,
      ADMIN_EMAILS: 'auth-e2e-admin@example.test', RESEND_API_KEY: '',
      NEXT_DIST_DIR: '.next-auth-e2e', VERCEL: '',
      AUTH_ALLOW_LOCAL_HTTP: '1',
    },
  },
})
