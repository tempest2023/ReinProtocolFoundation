import 'server-only'
import { Resend } from 'resend'
import { getSecretClient, requireSecretClient } from '@/lib/supabase/secret'
import { isPlausibleEmail } from '@/lib/security'
import {
  applicationReceivedTemplate,
  automaticRejectionTemplate,
  contributorVerificationTemplate,
  conversationInvitationTemplate,
  participantConfirmationTemplate,
  resourceUpdateTemplate,
} from '@/lib/email-templates'

type Message = {
  to: string
  subject: string
  html?: string
  template?: { id: string; variables: Record<string, string> }
  category: string
  relatedType?: string
  relatedId?: string
}

export async function sendTransactionalEmail(message: Message) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) throw new Error('Transactional email is not configured.')
  const resend = new Resend(apiKey)
  const client = getSecretClient()
  let deliveryLogged = false
  try {
    const { data, error } = await resend.emails.send(message.template
      ? { from, to: message.to, subject: message.subject, template: message.template }
      : { from, to: message.to, subject: message.subject, html: message.html ?? '' })
    if (client) {
      await client.from('email_deliveries').insert({
        recipient_email: message.to.toLowerCase(), category: message.category,
        related_type: message.relatedType ?? null, related_id: message.relatedId ?? null,
        provider_id: data?.id ?? null, status: error ? 'failed' : 'sent', error_message: error?.message ?? null,
      })
      deliveryLogged = true
    }
    if (error) throw new Error(error.message)
    return data
  } catch (error) {
    if (client && !deliveryLogged) {
      await client.from('email_deliveries').insert({
        recipient_email: message.to.toLowerCase(), category: message.category,
        related_type: message.relatedType ?? null, related_id: message.relatedId ?? null,
        provider_id: null, status: 'failed', error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown email error',
      })
    }
    throw error
  }
}

export async function sendParticipantConfirmation(email: string, name?: string, participantId?: string) {
  const templateId = process.env.RESEND_WELCOME_TEMPLATE_ID
  return sendTransactionalEmail({
    to: email,
    subject: 'You are registered with the Rein community',
    category: 'participant_confirmation',
    relatedType: participantId ? 'community_participant' : undefined,
    relatedId: participantId,
    ...(templateId
      ? { template: { id: templateId, variables: { USER_NAME: name?.trim() || 'there' } } }
      : { html: participantConfirmationTemplate(name) }),
  })
}

export async function sendContributorVerification(email: string, name: string, verificationUrl: string, applicationId: string) {
  return sendTransactionalEmail({
    to: email,
    subject: 'Verify your Rein Contributor application',
    category: 'contributor_verification', relatedType: 'contributor_application', relatedId: applicationId,
    html: contributorVerificationTemplate(name, verificationUrl),
  })
}

export async function sendApplicationReceived(email: string, name: string, applicationId: string) {
  return sendTransactionalEmail({
    to: email,
    subject: 'Your Contributor application is in review',
    category: 'application_confirmation', relatedType: 'contributor_application', relatedId: applicationId,
    html: applicationReceivedTemplate(name),
  })
}

export async function sendConversationInvitation(email: string, name: string, schedulingUrl: string, applicationId: string) {
  return sendTransactionalEmail({
    to: email,
    subject: 'Schedule a Rein Contributor conversation',
    category: 'conversation_invitation', relatedType: 'contributor_application', relatedId: applicationId,
    html: conversationInvitationTemplate(name, schedulingUrl),
  })
}

export async function sendAutomaticRejection(email: string, name: string, applicationId: string) {
  const client = requireSecretClient()
  const { data, error } = await client.from('site_settings').select('setting_value').eq('setting_key', 'email_identity').maybeSingle()
  if (error) throw error
  const monitored = String(data?.setting_value ?? '').trim().toLowerCase()
  if (!isPlausibleEmail(monitored)) throw new Error('A monitored contact email is required in Settings.')
  return sendTransactionalEmail({
    to: email,
    subject: 'Update on your Rein Contributor application',
    category: 'automatic_rejection', relatedType: 'contributor_application', relatedId: applicationId,
    html: automaticRejectionTemplate(name, monitored),
  })
}

export async function sendResourceUpdate(email: string, title: string, outcome: string, submissionId: string) {
  return sendTransactionalEmail({
    to: email,
    subject: `Update on your resource submission: ${title}`,
    category: 'resource_review_update', relatedType: 'resource_submission', relatedId: submissionId,
    html: resourceUpdateTemplate(title, outcome),
  })
}
