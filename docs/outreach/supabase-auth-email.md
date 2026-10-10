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

Confirmation and magic-link templates now use a first-party verification entry:

```text
{{ .SiteURL }}/auth/confirm#token_hash={{ .TokenHash }}&flow=confirm-email
{{ .SiteURL }}/auth/confirm#token_hash={{ .TokenHash }}&flow=admin-signin
```

The button and copyable fallback use the same URL. For administrator requests, the fixed
`RedirectTo` selects mutually exclusive email variants: `/auth/confirm` sends a link-only
email, and `/auth/code` sends a code-only email with a credential-free code-entry link.
Both confirmation and magic_link templates support these variants, including first sign-in.
The first-party page reads the fragment into component memory, removes it from the address
bar and automatically POSTs once to exchange it. HTTP GET, HEAD and non-JavaScript prefetch
do not consume credentials. Cross-browser sign-in does not require the requesting browser's
PKCE verifier. Reopen the original email after losing the in-memory credential. JavaScript
is required for automatic link sign-in; code sign-in is offered separately before sending.
Query-string tokens and nested ConfirmationURL inputs are intentionally unsupported.

Invite, recovery and email-change templates retain `{{ .ConfirmationURL }}` because their
complete product flows are outside this release. Reauthentication keeps `{{ .Token }}`
and email changes keep `{{ .NewEmail }}`. Do not substitute bare `{{ .RedirectTo }}`:
it has no verification credential. The legacy `/auth/callback` remains supported.
Administrator email copy states the configured two-hour validity; keep it synchronized with
`mailer_otp_exp = 7200`. OTP inputs use the configured eight-digit length.

The generated [Auth email preview](supabase-auth-email-preview.html) uses inert placeholder
credentials. It is regenerated and checked with the same script as the six HTML files.

For the shared hosted project, configure Resend SMTP at `smtp.resend.com:465`, username
`resend`, sender `Rein Protocol Foundation <noreply@rein-protocol.org>`, and the existing Resend
API key as the SMTP password. Keep credentials in Supabase's hosted SMTP settings, never
in tracked files. Local development continues to use its local mail catcher, not Resend.

New Free projects created on or after June 3, 2026 cannot customize templates while using
Supabase's default email service; custom SMTP removes that restriction. The linked Rein
project was created after that date, so custom SMTP is required for this branding.

Deploy the website before applying the four confirmation/magic_link subject and HTML fields
from `supabaseAuthEmailConfiguration()`. Preserve the other four flows. The full helper still
exports all twelve template fields for separate branding work. Do not run `supabase config
push`: local URLs and mail-catcher settings must not overwrite the hosted project.

The hosted project uses Resend SMTP with a project-wide limit of ten Auth emails per hour,
a 60-second resend cooldown, and 7200-second email credential validity. Browser session
cookies persist for 30 days, renewing when access tokens refresh. JWTs remain valid for
one hour. Sign Out clears and revokes the current session, preserving other devices.

Verify the saved template bodies and SMTP settings by reading the hosted Auth configuration
back. No email should be sent as a configuration test without an explicit request to do so.

On October 6, 2026, all six templates and Resend SMTP were applied to the linked hosted Rein
project and verified by reading the configuration back. The Site URL, redirect allowlist,
expiry, rate limits, and other account-security settings were preserved. Resend TLS and SMTP
authentication were checked without sending a message; local desktop/mobile rendering and
the generated HTML were also checked. Inbox delivery was not tested.


## First-party verification rollout

Local implementation does not change hosted Auth configuration. Before rollout:

1. Deploy the new routes while retaining `/auth/callback`. Confirm `/auth/confirm`,
   `/auth/confirmed` and `/api/auth/verify` return private/no-store responses; confirmation
   pages also use a per-request nonce CSP, no-referrer and noindex/nofollow headers.
2. Read back hosted Site URL (`https://rein-protocol.org`), `mailer_otp_length`, expiry,
   SMTP and security settings. Set `AUTH_EMAIL_OTP_LENGTH` to that actual length; the
   local config and default use eight digits. A production build served over loopback
   HTTP for testing requires `AUTH_ALLOW_LOCAL_HTTP=1`; this option is ignored on Vercel.
3. Back up Auth configuration, then update confirmation/magic_link subjects and HTML.
   Set email credential expiry to 7200 seconds and the SMTP email limit to 10/hour.
   Preserve Resend credentials, security flags, other templates and existing redirects;
   append the fixed `/auth/confirm` and `/auth/code` HTTPS callbacks if missing.
4. Read the bodies back. Keep email click/open tracking disabled. With separately
   authorized test recipients, test first-account confirmation, existing-account sign-in,
   OTP entry, another browser/device and Gmail/Outlook/Apple Mail including Safe Links.
5. For rollback, restore the backed-up subjects, bodies and relevant settings. Keep the new routes until previously
   sent first-party links expire plus a buffer; keep the legacy callback throughout.

Verification checks Origin against the configured Site URL and a ten-minute host-only
HttpOnly CSRF cookie. A nonce is reused while valid, so established tabs do not rotate it.
Admin eligibility is checked using the **verified** user ID or environment email allowlist;
changing a flow never grants access. Unauthorized verified users receive a distinct result.
Sessions and cookie chunks are written to the final Route Handler response, never JSON.

The shared `consume_form_rate_limit` RPC uses separate scopes: verification 30/IP/10 minutes,
OTP additionally 5/email/10 minutes, and delivery 10/IP/hour plus 3/email/hour. Email identifiers
are hashes scoped to the action. Counters use fixed UTC windows and report the remaining
window in Retry-After. RPC failure fails closed. On Vercel only `x-vercel-forwarded-for` is
trusted; outside Vercel all requests share an `unknown` IP bucket until a trusted ingress
adapter is implemented. Do not trust arbitrary forwarded headers. If another proxy sits
in front of Vercel, check which connection IP Vercel observes before adjusting thresholds.

Do not log credentials, POST bodies, cookies or full email links in application/proxy/APM
logs. The confirmation routes currently use the root layout with no third-party scripts.
Future global scripts must keep these routes excluded. Clients disable concurrent submissions
and do not automatically retry verification after an uncertain response.

## Local Auth regression test

`npm run test:e2e:auth` uses `playwright.auth.config.ts` and requires explicit local-only
configuration; it never falls back to a hosted `.env.local`. Provide environment variables
or `AUTH_E2E_ENV_FILE` pointing to a restricted, untracked env file:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
SUPABASE_SECRET_KEY=<local secret key>
AUTH_E2E_MAIL_URL=http://127.0.0.1:54324
AUTH_EMAIL_OTP_LENGTH=8
```

Use a running local Supabase instance with the repository migrations, email confirmations
and a local Mailpit SMTP catcher. The test builds into `.next-auth-e2e`, starts the website
on loopback, creates unique local test users, requests one local email per browser project,
verifies real Auth hashes/OTPs, checks navigation into protected pages, and deletes its users.
It covers desktop and mobile Chromium. Auth traces are disabled to avoid saving bearer
credentials. Mailpit messages remain local. Repeated runs share fixed-window IP counters;
wait for the window to expire if the local test bucket reaches its limit. This test does
not establish hosted SMTP delivery or Safe Links compatibility.
