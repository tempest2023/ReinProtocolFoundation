import { z } from 'zod'

export const verificationFlowSchema = z.enum(['admin-signin', 'confirm-email'])
export type VerificationFlow = z.infer<typeof verificationFlowSchema>
export const tokenHashSchema = z.string().min(1).max(512).regex(/^[a-zA-Z0-9_-]+$/)
export const verificationDestinations = { 'admin-signin': '/admin', 'confirm-email': '/auth/confirmed' } as const

export function emailVerificationSchema(otpLength: number) {
  const common = { flow: verificationFlowSchema, csrf: z.string().min(1).max(128) }
  return z.discriminatedUnion('mode', [
    z.strictObject({ ...common, mode: z.literal('link'), token_hash: tokenHashSchema }),
    z.strictObject({ ...common, mode: z.literal('otp'), email: z.string().max(320).trim().toLowerCase().refine((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)), token: z.string().regex(new RegExp(`^[0-9]{${otpLength}}$`)) }),
  ])
}

export type VerificationRequest = z.infer<ReturnType<typeof emailVerificationSchema>>

export function parseVerificationFragment(fragment: string): { flow: VerificationFlow; token_hash: string } | null {
  if (fragment.length > 2048) return null
  const fields = new URLSearchParams(fragment.replace(/^#/, ''))
  const keys = [...fields.keys()]
  if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some((key) => key !== 'flow' && key !== 'token_hash')) return null
  const result = z.strictObject({ flow: verificationFlowSchema, token_hash: tokenHashSchema }).safeParse(Object.fromEntries(fields))
  return result.success ? result.data : null
}

// The wire format is a flat object of strings. Scan before JSON.parse so even
// escaped duplicate keys cannot be silently replaced by JSON's last-value rule.
export function parseVerificationJson(text: string): Record<string, string> {
  const source = text.trim()
  if (!source.startsWith('{') || !source.endsWith('}')) throw new Error('invalid_request')
  const content = source.slice(1, -1)
  // JSON forbids unescaped control characters inside strings.
  // oxlint-disable-next-line no-control-regex
  const pair = /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")\s*:\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")\s*(,|$)/y
  const result: Record<string, string> = Object.create(null)
  let offset = 0
  while (offset < content.length) {
    pair.lastIndex = offset
    const match = pair.exec(content)
    if (!match) throw new Error('invalid_request')
    const key = JSON.parse(match[1]) as string
    if (Object.hasOwn(result, key)) throw new Error('invalid_request')
    result[key] = JSON.parse(match[2]) as string
    offset = pair.lastIndex
    if (match[3] === ',' && !content.slice(offset).trim()) throw new Error('invalid_request')
  }
  return result
}

export function classifyVerificationError(error: { status?: number; code?: string }) {
  if (error.status === 429 || error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit') return 'rate_limited'
  if (['otp_expired', 'access_denied'].includes(error.code ?? '')) return 'invalid_or_expired'
  return 'temporarily_unavailable'
}
