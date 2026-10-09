type AuthEmail = {
  name: 'confirmation' | 'magic_link' | 'invite' | 'recovery' | 'email_change' | 'reauthentication'
  subject: string
  heading: string
  preheader: string
  introduction: string
  action?: string
  securityNote: string
}

const definitions: AuthEmail[] = [
  {
    name: 'confirmation',
    subject: 'Confirm your email — Rein Protocol Foundation',
    heading: 'Confirm your email address.',
    preheader: 'Confirm your email address to continue with Rein.',
    introduction: 'Please confirm this email address to continue with your Rein account.',
    action: 'Confirm email address →',
    securityNote: 'If you did not request a Rein account, you can safely ignore this message.',
  },
  {
    name: 'magic_link',
    subject: 'Your sign-in link — Rein Protocol Foundation',
    heading: 'Sign in to Rein.',
    preheader: 'Your secure, one-time link to sign in to Rein.',
    introduction: 'Open the link below, then confirm on the Rein website to sign in. You can use a different browser or device. Opening the link alone does not sign you in.',
    action: 'Sign in to Rein →',
    securityNote: 'If you did not request this sign-in link, you can safely ignore this message. Do not forward it or share it with anyone.',
  },
  {
    name: 'invite',
    subject: 'You are invited to Rein — Rein Protocol Foundation',
    heading: 'You are invited to Rein.',
    preheader: 'Accept your invitation to create a Rein account.',
    introduction: 'You have been invited to create a Rein account. Use the button below to accept your invitation.',
    action: 'Accept invitation →',
    securityNote: 'If you were not expecting this invitation, you can safely ignore this message. An account invitation does not confer legal membership, Contributor status, or governance rights.',
  },
  {
    name: 'recovery',
    subject: 'Reset your password — Rein Protocol Foundation',
    heading: 'Reset your password.',
    preheader: 'Choose a new password for your Rein account.',
    introduction: 'We received a request to reset the password for your Rein account. Use the button below to choose a new password.',
    action: 'Reset password →',
    securityNote: 'If you did not request a password reset, ignore this message. Your password will not change unless you complete the reset.',
  },
  {
    name: 'email_change',
    subject: 'Confirm your email change — Rein Protocol Foundation',
    heading: 'Confirm your email change.',
    preheader: 'Confirm the requested email change for your Rein account.',
    introduction: 'A request was made to change the email address for your Rein account to {{ .NewEmail }}. Confirm this request using the button below.',
    action: 'Confirm email change →',
    securityNote: 'If you did not request this change, do not use the link. Contact admin@rein-protocol.org for help.',
  },
  {
    name: 'reauthentication',
    subject: '{{ .Token }} is your Rein verification code',
    heading: 'Verify it is you.',
    preheader: 'Your one-time verification code for a sensitive account action.',
    introduction: 'Enter the code below in Rein to confirm this sensitive account action.',
    securityNote: 'If you did not request this code, ignore this message. Never share a verification code with anyone, including someone claiming to be from Rein.',
  },
]

function renderAuthEmail(email: AuthEmail) {
  const firstParty = email.name === 'confirmation' || email.name === 'magic_link'
  const flow = email.name === 'confirmation' ? 'confirm-email' : 'admin-signin'
  const actionUrl = firstParty ? `{{ .SiteURL }}/auth/confirm#token_hash={{ .TokenHash }}&amp;flow=${flow}` : '{{ .ConfirmationURL }}'
  const actionHtml = email.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#a83f22" style="border:1px solid #a83f22;mso-padding-alt:13px 22px;"><a href="${actionUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:14px;font-weight:bold;line-height:1.4;text-decoration:none;">${email.action}</a></td></tr></table>
<p style="margin:22px 0 16px;color:#75695e;font-size:13px;line-height:1.65;">If the button does not work, copy and paste this link into your browser:<br><a href="${actionUrl}" style="color:#a83f22;text-decoration:underline;word-break:break-all;">${actionUrl}</a></p>${firstParty ? `
<p style="margin:0 0 16px;">Alternatively, enter your email address and the verification code below at <a href="{{ .SiteURL }}/auth/confirm" style="color:#a83f22;">the Rein confirmation page</a>. Select ${email.name === 'confirmation' ? 'Confirm email address' : 'Administrator sign-in'}.</p>
<p style="margin:0 0 20px;padding:18px;border:1px solid #d0c3ad;color:#a83f22;font-size:28px;font-weight:bold;letter-spacing:6px;line-height:1.5;text-align:center;">{{ .Token }}</p>` : ''}`
    : '<p style="margin:0 0 20px;padding:18px;border:1px solid #d0c3ad;color:#a83f22;font-size:28px;font-weight:bold;letter-spacing:6px;line-height:1.5;text-align:center;">{{ .Token }}</p>'

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${email.heading}</title></head>
<body style="margin:0;padding:0;background-color:#e8ddc8;color:#302a25;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${email.preheader}</div>
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
<h1 style="margin:0;font-family:Georgia,serif;font-size:34px;font-weight:normal;line-height:1.18;color:#302a25;">${email.heading}</h1>
</td></tr>
<tr><td align="center"><a href="https://rein-protocol.org/" style="text-decoration:none;"><img src="https://rein-protocol.org/images/welcome-golden-gate-cover.jpg" width="640" alt="The Golden Gate Bridge and San Francisco Bay in Rein’s paper-collage artwork." style="display:block;width:100%;max-width:640px;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:28px 24px 12px;font-size:15px;line-height:1.75;">
<p style="margin:0 0 16px;">Hello,</p>
<p style="margin:0 0 20px;">${email.introduction}</p>
${actionHtml}
<p style="margin:0 0 16px;">This ${email.action ? 'link' : 'code'} expires shortly and can only be used once.</p>
<p style="margin:0 0 20px;">${email.securityNote}</p>
<p style="margin:0 0 20px;">Rein Protocol Foundation</p>
</td></tr>
<tr><td style="padding:20px 24px 24px;border-top:1px solid #d5c7b1;color:#75695e;font-size:11px;line-height:1.65;">
<p style="margin:0 0 10px;">You received this security email because an account action was requested for this address.</p>
<p style="margin:0;"><a href="https://rein-protocol.org/" style="color:#75695e;">rein-protocol.org</a> · <a href="https://rein-protocol.org/privacy" style="color:#75695e;">Privacy</a> · <a href="mailto:admin@rein-protocol.org" style="color:#75695e;">Contact</a></p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
}

export const supabaseAuthEmailTemplates = definitions.map((email) => ({
  name: email.name,
  subject: email.subject,
  html: renderAuthEmail(email),
}))

export function supabaseAuthEmailConfiguration() {
  return Object.fromEntries(supabaseAuthEmailTemplates.flatMap((email) => [
    [`mailer_subjects_${email.name}`, email.subject],
    [`mailer_templates_${email.name}_content`, email.html],
  ]))
}
