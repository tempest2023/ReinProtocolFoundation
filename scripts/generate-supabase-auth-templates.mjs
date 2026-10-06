import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/supabase-auth-email.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { supabaseAuthEmailTemplates } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
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

console.log(`${checkOnly ? 'Verified' : 'Generated'} ${supabaseAuthEmailTemplates.length} Rein-branded Supabase Auth templates.`)
