# Supabase Auth email branding

The six Auth emails use the same Rein Protocol Foundation design as the community welcome
email: paper backgrounds, Rein logo, Golden Gate Bridge cover, serif heading, rust-red action,
and a compact security footer. The copy is account-security copy, not a community welcome or
marketing message. These templates are English and are independent of the Admin UI locale.

- Canonical source: `lib/supabase-auth-email.ts`.
- Supabase-ready HTML: `supabase/templates/*.html`.
- Regenerate: `node scripts/generate-supabase-auth-templates.mjs`.
- Check generated files: `node scripts/generate-supabase-auth-templates.mjs --check`.
- Local configuration: `auth.email.template.*` in `supabase/config.toml`.
- Hosted settings: **Authentication > Email Templates** and **Authentication > SMTP Settings**.

`magic_link` covers existing-account passwordless sign-in; `confirmation` covers email
confirmation, including a first-time account created through passwordless sign-in. Invitations,
password recovery, email changes, and reauthentication use their corresponding templates.
Security-notification settings are not enabled or changed by this template update.

Link-based templates keep `{{ .ConfirmationURL }}` in both the button and the fallback link.
Do not substitute a bare `{{ .RedirectTo }}` or hard-coded application URL: those skip the Auth
verification endpoint. Supabase generates the verification link with the allowed redirect
requested by the application. Production and local callback settings still need to be correct.
Reauthentication keeps `{{ .Token }}` as a code, and email changes keep `{{ .NewEmail }}`.
Neither OTP length nor expiry is hard-coded in the copy.

For the shared hosted project, configure Resend SMTP at `smtp.resend.com:465`, username
`resend`, sender `Rein Protocol Foundation <noreply@rein-protocol.org>`, and the existing Resend
API key as the SMTP password. Keep credentials in Supabase's hosted SMTP settings, never
in tracked files. Local development continues to use its local mail catcher, not Resend.

New Free projects created on or after June 3, 2026 cannot customize templates while using
Supabase's default email service; custom SMTP removes that restriction. The linked Rein
project was created after that date, so custom SMTP is required for this branding.

Apply only the twelve `mailer_subjects_*` / `mailer_templates_*_content` fields produced by
`supabaseAuthEmailConfiguration()` when changing templates. Configure SMTP separately if
needed. Do not run `supabase config push` for this change: the local configuration intentionally
retains localhost URLs, local SMTP behavior, and settings that must not overwrite the hosted
project. Preserve hosted redirects, account-security flags, expiry, and rate limits.

Verify the saved template bodies and SMTP settings by reading the hosted Auth configuration
back. No email should be sent as a configuration test without an explicit request to do so.

On October 6, 2026, all six templates and Resend SMTP were applied to the linked hosted Rein
project and verified by reading the configuration back. The Site URL, redirect allowlist,
expiry, rate limits, and other account-security settings were preserved. Resend TLS and SMTP
authentication were checked without sending a message; local desktop/mobile rendering and
the generated HTML were also checked. Inbox delivery was not tested.
