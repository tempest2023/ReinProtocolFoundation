import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supabaseAuthEmailConfiguration, supabaseAuthEmailTemplates } from '@/lib/supabase-auth-email'
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
    expect(section).toContain(`subject = "${subject}"`)
    expect(section).toContain(`content_path = "./supabase/templates/${name}.html"`)
  })

  it.each(supabaseAuthEmailTemplates.filter(({ name }) => name !== 'reauthentication'))('retains the Supabase verification URL for $name, including a copyable fallback', ({ html }) => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const links = [...document.querySelectorAll('a')].filter((link) => link.getAttribute('href') === '{{ .ConfirmationURL }}')
    expect(links).toHaveLength(2)
    expect(links[1].textContent).toBe('{{ .ConfirmationURL }}')
    expect(html).not.toContain('{{ .RedirectTo }}')
    expect(html).not.toContain('{{ .SiteURL }}')
    expect(html).toContain('can only be used once')
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
