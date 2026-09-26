import { describe, expect, it } from 'vitest'
import {
  automaticRejectionTemplate,
  contributorVerificationTemplate,
  conversationInvitationTemplate,
  participantConfirmationTemplate,
  resourceUpdateTemplate,
} from '@/lib/email-templates'

describe('transactional email templates', () => {
  it('preserves the legal-membership and public-access distinctions', () => {
    expect(participantConfirmationTemplate()).toContain('does not confer legal membership or governance rights')
    expect(contributorVerificationTemplate('Person', 'https://example.org/verify')).toContain('Most public resources and events are open')
  })

  it('describes the 1v1 accurately and never promises recording', () => {
    const html = conversationInvitationTemplate('Person', 'https://example.org/schedule')
    expect(html).toContain('not a traditional interview')
    expect(html).toContain('will not exceed 30 minutes')
    expect(html).toContain('do not record or automatically transcribe')
  })

  it('offers human review and keeps submitters out of resource attribution', () => {
    expect(automaticRejectionTemplate('Person', 'review@example.org')).toContain('A person can review and restore')
    expect(resourceUpdateTemplate('Resource', 'approved')).toContain('not the submitter')
  })

  it('escapes user-controlled values', () => {
    const html = contributorVerificationTemplate('<script>alert(1)</script>', 'https://example.org/?x="bad"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;bad&quot;')
  })
})
