function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function participantConfirmationTemplate(name?: string) {
  return `<p>Hello${name ? ` ${escapeHtml(name)}` : ''},</p><p>Your community registration is active. Most public resources and events remain open whether or not you are registered.</p><p>This registration does not create legal membership, employment, governance, ownership, Token, agency, or tax rights.</p><p>— Rein Protocol Foundation</p>`
}

export function contributorVerificationTemplate(name: string, verificationUrl: string) {
  return `<p>Hello ${escapeHtml(name)},</p><p>Confirm your email within 24 hours so your Contributor application can enter review.</p><p><a href="${escapeHtml(verificationUrl)}">Verify my email</a></p><p>Most public resources and events are open without becoming a Contributor. Applying is for people who want deeper participation, to organize activities, or to take responsibility for ongoing work.</p>`
}

export function applicationReceivedTemplate(name: string) {
  return `<p>Hello ${escapeHtml(name)},</p><p>Your email is verified and your application is now in review. If we invite you to a 1v1, it will be a conversation—not a traditional interview—and will last no more than 30 minutes.</p><p>We welcome people across industries, educational backgrounds, and professional paths.</p>`
}

export function conversationInvitationTemplate(name: string, schedulingUrl: string) {
  return `<p>Hello ${escapeHtml(name)},</p><p>We would like to invite you to a conversational 1v1 meeting. It is not a traditional interview. We will introduce Rein and the community, learn about your interests, discuss possible contribution paths, and answer questions. The conversation will not exceed 30 minutes.</p><p><a href="${escapeHtml(schedulingUrl)}">Choose a time</a></p><p>We do not record or automatically transcribe these conversations.</p>`
}

export function automaticRejectionTemplate(name: string, monitoredEmail: string) {
  return `<p>Hello ${escapeHtml(name)},</p><p>We cannot move this application forward because its written content appears to conflict with our communication and safety standards.</p><p>If you believe this decision is incorrect, contact <a href="mailto:${escapeHtml(monitoredEmail)}">${escapeHtml(monitoredEmail)}</a>. A person can review and restore the application.</p>`
}

export function resourceUpdateTemplate(title: string, outcome: string) {
  return `<p>Thank you for submitting <strong>${escapeHtml(title)}</strong>.</p><p>Review status: ${escapeHtml(outcome)}.</p><p>Publication, if approved, credits the resource’s factual author or publisher—not the submitter—and does not automatically create Contributor status.</p>`
}
