# Community welcome email

Published in Resend as `rein-community-welcome` (template ID `71f83c5c-716b-4125-a17a-f7f7df4f55df`). The production Vercel application sends this template for new community registrations using the `USER_NAME` variable.

- Canonical HTML: `lib/participant-welcome.ts`.
- Preview: `participant-welcome-preview.html` (preserves `{{{USER_NAME}}}`).
- Resend import: `participant-welcome-resend.html` (greeting: `Hello {{{USER_NAME}}},`).
- Regenerate both HTML files: `node scripts/preview-welcome-email.mjs`.

The cover is a 2:1 landscape version of the homepage Golden Gate Bridge artwork at `public/images/welcome-golden-gate-cover.jpg`. Created with the built-in imagegen editing tool: crop away upper/lower empty paper, retain bridge, bay, coast and orange line, preserve original style, add no objects or text. The local preview uses a relative image path; the Resend template uses the public HTTPS URL.

Production sending references the published Resend template through `RESEND_WELCOME_TEMPLATE_ID`. It sends the submitted name as `USER_NAME`, with `there` when blank. When no template ID is configured, the application uses inline HTML and escapes the name before substitution.

The hosted template defines `USER_NAME` as a string with fallback `there`. See [Resend variable documentation](https://resend.com/docs/dashboard/templates/template-variables). Community registration does not include email verification.
