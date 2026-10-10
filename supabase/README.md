# Database environments

Development and production share one Supabase project but never share application tables:

- local development, automated tests, local `next start`, and Vercel Preview use `dev_*` tables and `dev_*` RPCs;
- the production deployment uses `prod_*` tables and `prod_*` RPCs;
- Supabase Auth and the `community-images` Storage bucket remain shared project services.

`DATABASE_ENVIRONMENT=dev|prod` has the highest priority and is set to `dev` by default in local configuration. If it is omitted, the application falls back to Next.js/Vercel's built-in environment values and recognizes a localhost `NEXT_PUBLIC_SITE_URL`. Any unsupported non-empty value safely selects `dev`. Existing pre-prefix records were created during development and are preserved in the `dev_*` tables. The initial `prod_*` tables are empty.

Every future database migration must apply the same structural change to both prefixes in one transaction. Prefer a loop over `array['dev_', 'prod_']` for mechanical changes. When SQL cannot be safely parameterized, write both explicit statements in the same migration. Do not change only one environment table set.

Foreign keys, uniqueness, checks, and RLS remain local to each environment. There are no cross-environment constraints or data-copy triggers.

## Administrator authentication redirects

The login action selects `emailRedirectTo=${NEXT_PUBLIC_SITE_URL}/auth/confirm` for link-only mail or `/auth/code` for code-only mail.
Keep the application URL and the shared hosted project's **Authentication > URL Configuration** aligned:

| Setting | Production | Local development |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://rein-protocol.org` | `http://localhost:3000` (or `http://127.0.0.1:3000`) |
| Hosted Supabase Site URL | `https://rein-protocol.org` | Keep the shared project's production default |
| Hosted Supabase Redirect URLs | `https://rein-protocol.org/auth/callback?next=/admin` | `http://localhost:3000/auth/callback?next=/admin` and `http://127.0.0.1:3000/auth/callback?next=/admin` |

Keep the corresponding `/auth/callback` URLs without the query string allowed as well.
Use explicit callback URLs rather than a production-wide wildcard. Supabase falls back to
its Site URL when a requested redirect is not allowed; a localhost default therefore breaks
production login even when Vercel's `NEXT_PUBLIC_SITE_URL` is correct.

`supabase/config.toml` configures the local Supabase stack, whose Site URL intentionally remains
localhost. Do not push that local Auth configuration to the shared hosted project; update the
hosted URL settings separately while preserving other allowed redirects. Vercel Preview origins
must be added explicitly if email login is needed there. Changes to Vercel's `NEXT_PUBLIC_SITE_URL`
require a new build, but hosted Supabase URL configuration changes take effect without an application
deployment. Request a new sign-in email after correcting these settings.

## Branded authentication emails

The six Auth templates use Rein's common email design. Sources, generation instructions,
Supabase template variables, and hosted SMTP setup are documented in
[`docs/outreach/supabase-auth-email.md`](../docs/outreach/supabase-auth-email.md).
Local templates are configured in this directory's `config.toml`; hosted templates must be
updated separately without pushing localhost configuration into the shared project.

Authentication emails expire after 7200 seconds (2 hours). Both confirmation and magic_link templates select a link-only or code-only variant using the fixed RedirectTo path. The first-party link is automatically exchanged on hydration; GET/HEAD alone do not consume it.

Hosted Auth uses Resend custom SMTP (`smtp.resend.com:465`, user `resend`, sender
`noreply@rein-protocol.org`) with `rate_limit_email_sent = 10` per hour across the project.
SMTP credentials stay in the hosted settings; never commit them or push local SMTP configuration.
The 60-second resend cooldown and application limits still apply independently.

Browser Auth cookies are HttpOnly (Secure on HTTPS), persist for 30 days and renew when the proxy refreshes the session.
Access tokens remain valid for one hour; hosted session timebox and inactivity timeout are disabled,
and multiple devices are allowed. Sign Out revokes only the current session and clears its cookies.
The cookie policy is applied at all SSR write boundaries because the installed SDK overrides
`cookieOptions.maxAge` with its own default. Cookie deletion must retain `Max-Age=0`.
