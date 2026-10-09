import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDirectAdminLoginEnabled, isSupabasePublishableKey, isSupabaseSecretKey } from '@/lib/env'
import type { SupabaseClient } from '@supabase/supabase-js'
import { databaseEnvironment, databaseFunction, databaseRelation, databaseTable, scopeDatabaseClient } from '@/lib/supabase/database-names'

afterEach(() => vi.unstubAllEnvs())

describe('runtime configuration', () => {
  it('allows the complete administrator callback URLs in local Supabase Auth', () => {
    const config = readFileSync('supabase/config.toml', 'utf8')
    const authConfig = config.split('[auth]\n')[1]?.split('\n[auth.')[0] ?? ''
    const redirects = authConfig.match(/additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? ''

    expect(authConfig).toContain('site_url = "http://localhost:3000"')
    expect(redirects).toContain('"http://localhost:3000/auth/callback?next=/admin"')
    expect(redirects).toContain('"http://127.0.0.1:3000/auth/callback?next=/admin"')
    expect(redirects).not.toContain('**')
  })

  it('accepts current Supabase keys and rejects legacy JWT keys', () => {
    expect(isSupabasePublishableKey('sb_publishable_example')).toBe(true)
    expect(isSupabaseSecretKey('sb_secret_example')).toBe(true)
    expect(isSupabasePublishableKey('eyJhbGciOiJIUzI1NiJ9.legacy-anon')).toBe(false)
    expect(isSupabaseSecretKey('eyJhbGciOiJIUzI1NiJ9.legacy-service-role')).toBe(false)
  })

  it('keeps public forms enabled without launch environment flags', () => {
    const example = readFileSync('.env.example', 'utf8')
    const actions = readFileSync('lib/community/actions.ts', 'utf8')

    expect(example).not.toContain('NEXT_PUBLIC_COMMUNITY_FORMS_ENABLED')
    expect(example).not.toContain('COMMUNITY_LAUNCH_APPROVED')
    expect(actions).not.toContain('communityFormsOperational')
  })

  it('keeps operational and Agent choices in Dashboard settings rather than environment variables', () => {
    const example = readFileSync('.env.example', 'utf8')
    const adminSettings = readFileSync('app/admin/(dashboard)/settings/page.tsx', 'utf8')
    const email = readFileSync('lib/email.ts', 'utf8')
    const privacy = readFileSync('app/(site)/privacy/page.tsx', 'utf8')
    const conduct = readFileSync('app/(site)/community/code-of-conduct/page.tsx', 'utf8')

    expect(example).not.toContain('SCHEDULING_URL')
    expect(example).not.toContain('GITHUB_REPOSITORY_URL')
    expect(example).not.toContain('MONITORED_CONTACT_EMAIL')
    expect(example).not.toContain('OPENAI_MODEL')
    expect(adminSettings).toContain('scheduling_url')
    expect(adminSettings).toContain('github_repository_url')
    expect(adminSettings).toContain('email_identity')
    expect(adminSettings).toContain('openai_model')
    expect(adminSettings).toContain('openai_reasoning_effort')
    expect(email).toContain(".eq('setting_key', 'email_identity')")
    expect(email).not.toContain('process.env.MONITORED_CONTACT_EMAIL')
    expect(privacy).toContain("getPublicSiteSettings(['email_identity'])")
    expect(conduct).toContain("getPublicSiteSettings(['email_identity'])")
  })

  it('uses only current Supabase publishable and secret environment variables', () => {
    const example = readFileSync('.env.example', 'utf8')
    const environment = readFileSync('lib/env.ts', 'utf8')

    expect(example).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=')
    expect(example).toContain('SUPABASE_SECRET_KEY=')
    expect(example).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(example).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(environment).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(environment).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('uses database retention scheduling without public cron secrets or routes', () => {
    const example = readFileSync('.env.example', 'utf8')
    const migration = readFileSync('supabase/migrations/202608130001_simplify_runtime_configuration.sql', 'utf8')
    const agentProcessing = readFileSync('lib/agent/process.ts', 'utf8')

    expect(example).not.toContain('IP_HASH_SECRET')
    expect(example).not.toContain('CRON_SECRET')
    expect(existsSync('vercel.json')).toBe(false)
    expect(agentProcessing).not.toContain('processRetryableAgentJobs')
    expect(migration).toContain('beneficence-retention-maintenance')
    expect(migration).toContain('public.run_retention_maintenance()')
  })

  it('documents raw IP collection and seven-day retention', () => {
    const privacy = readFileSync('app/(site)/privacy/page.tsx', 'utf8')
    const migration = readFileSync('supabase/migrations/202608130001_simplify_runtime_configuration.sql', 'utf8')

    expect(privacy).toContain('IP address')
    expect(privacy).toContain('within seven days')
    expect(migration).toContain("identifier_type in ('ip','email_hash')")
  })

  it('allows direct admin login only in development when Resend is absent', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', '')
    expect(isDirectAdminLoginEnabled()).toBe(true)

    vi.stubEnv('RESEND_API_KEY', 're_test')
    expect(isDirectAdminLoginEnabled()).toBe(false)

    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    expect(isDirectAdminLoginEnabled()).toBe(false)
  })

  it('scopes database names to development outside production', () => {
    vi.stubEnv('DATABASE_ENVIRONMENT', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(databaseEnvironment()).toBe('dev')
    expect(databaseTable('people')).toBe('dev_people')
    expect(databaseFunction('get_public_community_metrics')).toBe('dev_get_public_community_metrics')
    expect(databaseRelation('event_sessions')).toBe('event_sessions:dev_event_sessions')

    vi.stubEnv('NODE_ENV', 'test')
    expect(databaseTable('people')).toBe('dev_people')
  })

  it('scopes database names to production in production builds', () => {
    vi.stubEnv('DATABASE_ENVIRONMENT', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(databaseEnvironment()).toBe('prod')
    expect(databaseTable('people')).toBe('prod_people')
    expect(databaseFunction('get_public_community_metrics')).toBe('prod_get_public_community_metrics')
    expect(databaseRelation('sessions', 'event_sessions')).toBe('sessions:prod_event_sessions')
  })

  it('keeps local production-mode smoke tests on development data', () => {
    vi.stubEnv('DATABASE_ENVIRONMENT', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')
    expect(databaseEnvironment()).toBe('dev')
  })

  it('gives the explicit database environment the highest priority', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('DATABASE_ENVIRONMENT', 'dev')
    expect(databaseEnvironment()).toBe('dev')

    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('DATABASE_ENVIRONMENT', 'prod')
    expect(databaseEnvironment()).toBe('prod')

    vi.stubEnv('DATABASE_ENVIRONMENT', 'invalid')
    expect(databaseEnvironment()).toBe('dev')
  })

  it('scopes Supabase table and RPC calls without changing Auth or Storage', () => {
    vi.stubEnv('DATABASE_ENVIRONMENT', 'dev')
    vi.stubEnv('NODE_ENV', 'development')
    const from = vi.fn((table: string) => table)
    const rpc = vi.fn((name: string) => name)
    const auth = { getUser: vi.fn() }
    const storage = { from: vi.fn() }
    const client = scopeDatabaseClient({ from, rpc, auth, storage } as unknown as SupabaseClient)

    client.from('people')
    client.rpc('get_public_community_metrics')

    expect(from).toHaveBeenCalledWith('dev_people')
    expect(rpc).toHaveBeenCalledWith('dev_get_public_community_metrics', undefined, undefined)
    expect(client.auth).toBe(auth)
    expect(client.storage).toBe(storage)
  })
})
