import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

// Render the same source used by the application; no separately maintained HTML.
const source = readFileSync(new URL('../lib/participant-welcome.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { participantWelcomeHtml } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const preview = participantWelcomeHtml
  .replace('https://rein-protocol.org/images/welcome-golden-gate-cover.jpg', '../../public/images/welcome-golden-gate-cover.jpg')
writeFileSync(new URL('../docs/outreach/participant-welcome-preview.html', import.meta.url), preview)
writeFileSync(new URL('../docs/outreach/participant-welcome-resend.html', import.meta.url), participantWelcomeHtml)
console.log('Generated welcome preview and Resend template, both preserving USER_NAME.')
