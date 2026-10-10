import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supabaseAuthEmailConfiguration, supabaseAuthEmailTemplates, supabaseAuthEmailPreviews } from '@/lib/supabase-auth-email'
import { participantConfirmationTemplate } from '@/lib/email-templates'

describe('Rein Supabase Auth emails', () => {
  it.each(supabaseAuthEmailTemplates)('keeps $name in the canonical Rein email design', ({ html }) => {
    const welcome = participantConfirmationTemplate()
    for (const branding of ['#e8ddc8', '#f5ead3', '#a83f22', 'rein-mark-header.png', 'welcome-golden-gate-cover.jpg', 'REIN PROTOCOL<br>FOUNDATION']) {
      expect(welcome).toContain(branding)
      expect(html).toContain(branding)
    }
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('role="presentation"')
    expect(html).toContain('max-width:640px')
    expect(html).toContain('ACCOUNT SECURITY')
    expect(html).not.toMatch(/<script|localhost|127\.0\.0\.1|\{\{\{USER_NAME\}\}\}/)
  })

  it.each(supabaseAuthEmailTemplates)('keeps generated $name HTML synchronized with the source and local configuration', ({ name, subject, html }) => {
    expect(readFileSync(`supabase/templates/${name}.html`, 'utf8')).toBe(`${html}\n`)
    const config = readFileSync('supabase/config.toml', 'utf8')
    const section = config.split(`[auth.email.template.${name}]\n`)[1]?.split('\n[')[0]
    expect(section).toContain(subject)
    expect(section).toContain(`content_path = "./supabase/templates/${name}.html"`)
  })

  it.each(supabaseAuthEmailTemplates.filter(({ name }) => ['invite', 'recovery', 'email_change'].includes(name)))('retains the Supabase verification URL for $name, including a copyable fallback', ({ html }) => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const links = [...document.querySelectorAll('a')].filter((link) => link.getAttribute('href') === '{{ .ConfirmationURL }}')
    expect(links).toHaveLength(2)
    expect(links[1].textContent).toBe('{{ .ConfirmationURL }}')
    expect(html).not.toContain('{{ .RedirectTo }}')
    expect(html).not.toContain('{{ .SiteURL }}')
    expect(html).toContain('can only be used once')
  })

  it.each(supabaseAuthEmailPreviews.filter(({ name }) => name.endsWith('-link')))('keeps $name link-only', ({ html }) => {
    expect(html).toContain('/auth/confirm#token_hash={{ .TokenHash }}&amp;flow=')
    expect(html).not.toContain('{{ .Token }}')
    expect(html).not.toContain('/auth/code')
    expect(html).not.toContain('then confirm')
    expect(html).toContain('valid for 2 hours')
    expect(html).not.toContain('{{ .ConfirmationURL }}')
  })

  it.each(supabaseAuthEmailPreviews.filter(({ name }) => name.endsWith('-code')))('keeps $name code-only', ({ html }) => {
    expect(html).toContain('{{ .Token }}')
    expect(html).toContain('{{ .SiteURL }}/auth/code')
    expect(html).not.toContain('{{ .TokenHash }}')
    expect(html).not.toContain('/auth/confirm')
    expect(html).toContain('valid for 2 hours')
  })

  it('selects email variants using fixed redirect paths, without user metadata or an arbitrary action URL', () => {
    for (const email of supabaseAuthEmailTemplates.filter(({ name }) => ['confirmation', 'magic_link'].includes(name))) {
      expect(email.html).toContain('eq .RedirectTo (print .SiteURL "/auth/code")')
      expect(email.html).toContain('eq .RedirectTo (print .SiteURL "/auth/confirm")')
      expect(email.subject).toContain('Your sign-in code')
      expect(email.html).not.toContain('{{ .Data')
      expect(email.html).not.toContain('href="{{ .RedirectTo }}"')
    }
  })

  it('preserves code-only reauthentication and the email-change variable', () => {
    const verification = supabaseAuthEmailTemplates.find(({ name }) => name === 'reauthentication')!
    expect(verification.html).toContain('{{ .Token }}')
    expect(verification.html).not.toContain('{{ .ConfirmationURL }}')
    expect(verification.subject).toContain('{{ .Token }}')
    expect(supabaseAuthEmailTemplates.find(({ name }) => name === 'email_change')!.html).toContain('{{ .NewEmail }}')
  })

  it('updates only template subjects and HTML, never authentication or SMTP settings', () => {
    const config = supabaseAuthEmailConfiguration()
    expect(Object.keys(config)).toHaveLength(12)
    expect(Object.keys(config).every((key) => /^mailer_(subjects_\w+|templates_\w+_content)$/.test(key))).toBe(true)
    for (const email of supabaseAuthEmailTemplates) {
      expect(config[`mailer_subjects_${email.name}`]).toBe(email.subject)
      expect(config[`mailer_templates_${email.name}_content`]).toBe(email.html)
    }
  })
})
