import { participantWelcomeHtml } from './participant-welcome'

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function participantConfirmationTemplate(name?: string) {
  return participantWelcomeHtml.replace('{{{USER_NAME}}}', () => escapeHtml(name?.trim() || 'there'))
}

export function contributorVerificationTemplate(name: string, verificationUrl: string) {
  return `<p>Hello ${escapeHtml(name)},</p><p>Confirm your email within 24 hours so your Contributor application can enter review.</p><p><a href="${escapeHtml(verificationUrl)}">Verify my email</a></p><p>Most public resources and events are open without becoming a Contributor. Applying is for people who want deeper participation, to organize activities, or to take responsibility for ongoing work.</p>`
}

export function identityLinkReceiptTemplate(receiptUrl: string) {
  const safeReceiptUrl = escapeHtml(receiptUrl)
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your Rein community identity link</title></head>
<body style="margin:0;padding:0;background-color:#e8ddc8;color:#302a25;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Confirm your email address, then return the one-time code to the Rein Agent.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#e8ddc8"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="640" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5ead3" style="max-width:640px;border:1px solid #d0c3ad;font-family:Arial,sans-serif;">
<tr><td style="padding:24px;border-bottom:1px solid #d5c7b1;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td width="64" valign="middle"><a href="https://rein-protocol.org/"><img src="https://rein-protocol.org/brand/rein-mark-header.png" width="64" height="64" alt="Rein logo" style="display:block;border:0;width:64px;height:64px;"></a></td>
<td valign="middle" style="padding-left:16px;color:#302a25;font-size:16px;font-weight:bold;letter-spacing:2px;line-height:1.5;">REIN PROTOCOL<br>FOUNDATION</td>
</tr></table></td></tr>
<tr><td style="padding:28px 24px 20px;">
<p style="margin:0 0 12px;color:#75695e;font-size:11px;letter-spacing:2px;line-height:1.5;">ACCOUNT SECURITY</p>
<h1 style="margin:0;font-family:Georgia,serif;font-size:34px;font-weight:normal;line-height:1.18;color:#302a25;">Confirm your community identity link.</h1>
</td></tr>
<tr><td align="center"><a href="https://rein-protocol.org/" style="text-decoration:none;"><img src="https://rein-protocol.org/images/welcome-golden-gate-cover.jpg" width="640" alt="The Golden Gate Bridge and San Francisco Bay in Rein’s paper-collage artwork." style="display:block;width:100%;max-width:640px;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:28px 24px 12px;font-size:15px;line-height:1.75;">
<p style="margin:0 0 16px;">Hello,</p>
<p style="margin:0 0 16px;">A request was made to connect a chat account to the Rein community identity registered with this email address.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#a83f22" style="border:1px solid #a83f22;mso-padding-alt:13px 22px;"><a href="${safeReceiptUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:14px;font-weight:bold;line-height:1.4;text-decoration:none;">Confirm on the Rein website →</a></td></tr></table>
<p style="margin:22px 0 16px;"><strong>The email does not contain the binding code.</strong> After you confirm the address on the Rein website, that page will show a short one-time code. Return to the chat and send the code to the Rein Agent to finish linking.</p>
<p style="margin:0 0 16px;">This link expires in ten minutes and can be used once. If you did not request it, ignore this message; nothing changes unless the address is confirmed and the code is returned from the requesting chat account.</p>
<p style="margin:0 0 20px;">Confirming an address does not by itself create community membership, Contributor status, or governance rights.</p>
</td></tr>
<tr><td style="padding:20px 24px 24px;border-top:1px solid #d5c7b1;color:#75695e;font-size:11px;line-height:1.65;">
<p style="margin:0 0 10px;">You received this security email because someone entered this address in Rein’s account-linking flow.</p>
<p style="margin:0;"><a href="https://rein-protocol.org/" style="color:#75695e;">rein-protocol.org</a> · <a href="https://rein-protocol.org/privacy" style="color:#75695e;">Privacy</a></p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
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
