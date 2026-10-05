'use server'
import { headers } from 'next/headers'
import { hashedRateIdentifier, isPlausibleEmail } from '@/lib/security'
import { identityLinkReceiptTemplate } from '@/lib/email-templates'
import { sendTransactionalEmail } from '@/lib/email'
import {
  confirmLinkEmail as confirmLinkEmailDomain,
  issueEmailChallenge,
  lookupLinkSession,
} from '@/lib/identity/linking'

export type LinkFormState = {
  status: 'idle' | 'error' | 'success' | 'code'
  message: string
  code?: string
  fieldErrors?: Record<string, string>
}

const GENERIC_SENT =
  'If that address belongs to a Rein Protocol record, a confirmation message is on its way. Open it and follow the link inside.'

const INVALID_SESSION =
  'This page is no longer valid. Ask the Rein Agent in your chat platform for a new link and start again.'

const IDENTITY_LINK_PUBLIC_ORIGIN = 'https://rein-protocol.org'

function identityLinkReceiptUrl(receiptToken: string, sessionToken: string): string {
  const url = new URL('/community/link/confirm', IDENTITY_LINK_PUBLIC_ORIGIN)
  url.searchParams.set('receipt', receiptToken)
  url.searchParams.set('session', sessionToken)
  return url.toString()
}

async function requestIpHash(): Promise<string | null> {
  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
  const candidate = forwarded ?? requestHeaders.get('x-real-ip')?.trim()
  return candidate ? hashedRateIdentifier('identity-link-ip', candidate) : null
}

export async function requestLinkEmail(
  _previous: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const sessionToken = String(formData.get('session_token') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()

  if (!sessionToken) return { status: 'error', message: INVALID_SESSION }
  if (!isPlausibleEmail(email)) {
    return {
      status: 'error',
      message: 'Check the address and try again.',
      fieldErrors: { email: 'Enter a valid email address.' },
    }
  }

  const session = await lookupLinkSession(sessionToken)
  if (!session || session.state !== 'awaiting_email') {
    return { status: 'error', message: INVALID_SESSION }
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return { status: 'error', message: INVALID_SESSION }
  }

  const challenge = await issueEmailChallenge({
    sessionToken,
    email,
    ipHash: await requestIpHash(),
  })
  if (!challenge.ok) {
    if (challenge.reason === 'rate_limited') {
      return { status: 'error', message: 'Please wait a little before requesting another message.' }
    }
    return { status: 'error', message: INVALID_SESSION }
  }

  const receiptUrl = identityLinkReceiptUrl(challenge.receiptToken, sessionToken)
  try {
    await sendTransactionalEmail({
      to: email,
      subject: 'Confirm your Rein Protocol community identity link',
      html: identityLinkReceiptTemplate(receiptUrl),
      category: 'identity_link_receipt',
    })
  } catch {
    return {
      status: 'error',
      message: 'We could not send the confirmation message just now. Please try again shortly.',
    }
  }

  return { status: 'success', message: GENERIC_SENT }
}

export async function confirmLinkEmail(
  _previous: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const sessionToken = String(formData.get('session_token') ?? '').trim()
  const receiptToken = String(formData.get('receipt_token') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()

  if (!sessionToken || !receiptToken) return { status: 'error', message: INVALID_SESSION }
  if (!isPlausibleEmail(email)) {
    return {
      status: 'error',
      message: 'Enter the same email address you used on the previous step.',
      fieldErrors: { email: 'Enter the address this link was sent to.' },
    }
  }

  const confirmed = await confirmLinkEmailDomain({
    sessionToken,
    receiptToken,
    email,
    code: code || null,
  })
  if (!confirmed.ok) {
    if (confirmed.reason === 'binding_expired' || confirmed.reason === 'email_receipt_invalid') {
      return {
        status: 'error',
        message: 'This confirmation link has expired or was already used. Ask the Rein Agent for a new one.',
      }
    }
    if (confirmed.reason === 'contact_ambiguous') {
      return {
        status: 'error',
        message: 'This address matches more than one community record, so a person needs to review it. We have kept the request.',
      }
    }
    if (confirmed.reason === 'contact_not_registered') {
      return {
        status: 'error',
        message: 'This email address is not registered with the Rein community. Contact an administrator to register before linking your chat account.',
      }
    }
    if (confirmed.reason === 'binding_code_invalid') {
      return { status: 'error', message: 'That confirmation is not valid. Check the link you received and try again.' }
    }
    return { status: 'error', message: INVALID_SESSION }
  }

  return {
    status: 'code',
    message: 'Thanks. Give this code to the Rein Agent in your chat platform to finish linking. It is short lived.',
    code: confirmed.bindingCode,
  }
}
