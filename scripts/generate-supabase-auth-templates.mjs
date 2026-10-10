import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/supabase-auth-email.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { supabaseAuthEmailTemplates, supabaseAuthEmailPreviews } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
const directory = new URL('../supabase/templates/', import.meta.url)
const checkOnly = process.argv.includes('--check')

if (!checkOnly) mkdirSync(directory, { recursive: true })
for (const email of supabaseAuthEmailTemplates) {
  const path = new URL(`${email.name}.html`, directory)
  const html = `${email.html}\n`
  if (checkOnly) {
    if (readFileSync(path, 'utf8') !== html) throw new Error(`Regenerate ${email.name}.html from lib/supabase-auth-email.ts.`)
  } else {
    writeFileSync(path, html)
  }
}

const escapeAttribute = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const preview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rein Auth email previews</title><style>body{background:#e8ddc8;color:#302a25;font:16px Arial,sans-serif;margin:24px}main{max-width:760px;margin:auto}iframe{width:100%;height:1400px;border:0}h1,h2{font-family:Georgia,serif}p{line-height:1.6}</style></head><body><main><h1>Rein Auth email previews</h1><p>Generated from the canonical templates. Preview credentials are placeholders. Email link and code sign-in are separate variants. Links sign in automatically; codes are entered on Rein. Other flows retain their Supabase URL.</p>${supabaseAuthEmailPreviews.map((email) => {
  const html = email.html.replaceAll('{{ .SiteURL }}', 'https://rein-protocol.org').replaceAll('{{ .TokenHash }}', 'preview-token-not-valid').replaceAll('{{ .Token }}', '12345678').replaceAll('{{ .ConfirmationURL }}', 'https://example.invalid/auth/verify').replaceAll('{{ .NewEmail }}', 'preview@example.invalid')
  return `<section><h2>${email.name}</h2><p>${email.subject.replaceAll('{{ .Token }}', '12345678')}</p><iframe title="${email.name} email preview" sandbox srcdoc="${escapeAttribute(html)}"></iframe></section>`
}).join('')}</main></body></html>\n`
const previewPath = new URL('../docs/outreach/supabase-auth-email-preview.html', import.meta.url)
if (checkOnly) {
  if (readFileSync(previewPath, 'utf8') !== preview) throw new Error('Regenerate the Supabase Auth email preview.')
} else writeFileSync(previewPath, preview)

console.log(`${checkOnly ? 'Verified' : 'Generated'} ${supabaseAuthEmailTemplates.length} Rein-branded Supabase Auth templates.`)
