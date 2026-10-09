'use server'

import { after } from 'next/server'
import { publicEnv } from '@/lib/env'
import { contributorSchema, formDataRecord, participantSchema, resourceSubmissionSchema, zodErrors } from '@/lib/community/schemas'
import type { ActionState } from '@/lib/community/types'
import { requireSecretClient } from '@/lib/supabase/secret'
import { createVerificationToken, hashedRateIdentifier, normalizeEmail } from '@/lib/security'
import { consumeFormRateLimit as consumeLimit } from '@/lib/rate-limit'
import { sendContributorVerification, sendParticipantConfirmation } from '@/lib/email'

function databaseMessage(error: { message: string }) {
  if (error.message.includes('rate_limit_exceeded')) return 'We received too many submissions from this connection. Please try again later. Your information was not submitted.'
  return 'Please try again in a few minutes. Your information was not submitted.'
}

function submissionError(error: { message: string }): ActionState {
  return { status: 'error', presentation: 'dialog', message: databaseMessage(error) }
}

function hourWindow() {
  const date = new Date(); date.setUTCMinutes(0, 0, 0); return date
}

function dayWindow() {
  const date = new Date(); date.setUTCHours(0, 0, 0, 0); return date
}

export async function registerParticipant(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = participantSchema.safeParse(formDataRecord(formData))
  if (!result.success) return { status: 'error', message: 'Review the highlighted fields.', fieldErrors: zodErrors(result.error) }
  try {
    await consumeLimit('community_registration', hourWindow(), 10)
    const client = requireSecretClient()
    const data = result.data
    const { data: created, error } = await client.rpc('register_community_participant', {
      p_email: normalizeEmail(data.email), p_name: data.name ?? null, p_industry: data.industry,
      p_industry_other: data.industry_other ?? null, p_location_scope: data.location_scope,
      p_country: data.location_scope === 'international' ? data.country : 'United States',
      p_us_state: data.location_scope === 'united_states' ? data.us_state : null,
      p_city_region: data.city_region, p_communications_consent: true, p_privacy_consent: true,
    })
    if (error) return submissionError(error)
    const participantId = created?.[0]?.participant_id as string | undefined
    after(async () => { try { await sendParticipantConfirmation(data.email, data.name, participantId) } catch { /* administrator can inspect provider configuration */ } })
    return {
      status: 'success', presentation: 'dialog', dialogKicker: 'Registration complete', dialogTitle: 'You’re registered.',
      message: 'We will use your information only for community communication and administration.',
    }
  } catch (error) {
    return submissionError(error as Error)
  }
}

export async function submitContributorApplication(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const record = formDataRecord(formData)
  record.participation_reasons = formData.getAll('participation_reasons')
  record.contribution_areas = formData.getAll('contribution_areas')
  const result = contributorSchema.safeParse(record)
  if (!result.success) return { status: 'error', message: 'Review the highlighted fields.', fieldErrors: zodErrors(result.error) }
  try {
    await consumeLimit('contributor_application', dayWindow(), 5)
    const client = requireSecretClient()
    const { token, hash } = createVerificationToken()
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const data = result.data
    const { data: created, error } = await client.rpc('create_contributor_application', {
      p_name: data.name, p_email: normalizeEmail(data.email), p_industry: data.industry ?? null,
      p_industry_other: data.industry_other ?? null, p_location_scope: data.location_scope,
      p_country: data.location_scope === 'international' ? data.country : 'United States',
      p_us_state: data.location_scope === 'united_states' ? data.us_state : null, p_city_region: data.city_region,
      p_participation_reasons: data.participation_reasons, p_participation_reason_other: data.participation_reason_other ?? null,
      p_contribution_areas: data.contribution_areas, p_contribution_area_other: data.contribution_area_other ?? null,
      p_personal_website: data.personal_website ?? null, p_github_url: data.github_url ?? null,
      p_scholar_url: data.scholar_url ?? null, p_linkedin_url: data.linkedin_url ?? null,
      p_profile_willingness: data.profile_willingness ?? null, p_verification_token_hash: hash,
      p_verification_expires_at: expires.toISOString(), p_privacy_consent: true, p_conduct_consent: true,
    })
    const applicationId = created?.[0]?.application_id as string | undefined
    if (error || !applicationId) return submissionError(error ?? new Error('No application was returned.'))
    const verifyUrl = `${publicEnv.siteUrl}/api/contributor/verify?token=${encodeURIComponent(token)}`
    after(async () => { try { await sendContributorVerification(data.email, data.name, verifyUrl, applicationId) } catch { /* administrator can resend */ } })
    return {
      status: 'success', presentation: 'dialog', dialogKicker: 'Application received', dialogTitle: 'Application submitted.',
      message: 'Your application was saved and counted. Check your email within 24 hours to verify it and begin review.',
    }
  } catch (error) {
    return submissionError(error as Error)
  }
}

export async function submitResource(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = resourceSubmissionSchema.safeParse(formDataRecord(formData))
  if (!result.success) return { status: 'error', message: 'Review the highlighted fields.', fieldErrors: zodErrors(result.error) }
  try {
    const start = dayWindow()
    await consumeLimit('resource_submission_ip', start, 10)
    const data = result.data
    await consumeLimit('resource_submission_email', start, 3, { type: 'email_hash', value: hashedRateIdentifier('resource-email', normalizeEmail(data.contact_email)) })
    const client = requireSecretClient()
    const { error } = await client.rpc('create_resource_submission', {
      p_contact_email: normalizeEmail(data.contact_email), p_submitter_name: data.submitter_name ?? null,
      p_title: data.title, p_public_url: data.public_url, p_format: data.format, p_language: data.language,
      p_description: data.description,
      // Keep the deployed RPC signature compatible while the public form uses one combined description.
      p_ai_agent_relevance: data.description,
      p_author_publisher: data.author_publisher, p_access_confirmation: true,
      p_copyright_confirmation: true, p_privacy_consent: true,
    })
    if (error) return submissionError(error)
    return {
      status: 'success', presentation: 'dialog', dialogKicker: 'Resource received', dialogTitle: 'Resource submitted.',
      message: 'Your resource is queued for administrative review. An administrator decides whether to run an Agent review; submission does not create Contributor status.',
    }
  } catch (error) {
    return submissionError(error as Error)
  }
}
