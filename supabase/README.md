# Database environments

Development and production share one Supabase project but never share application tables:

- local development, automated tests, local `next start`, and Vercel Preview use `dev_*` tables and `dev_*` RPCs;
- the production deployment uses `prod_*` tables and `prod_*` RPCs;
- Supabase Auth and the `community-images` Storage bucket remain shared project services.

`DATABASE_ENVIRONMENT=dev|prod` has the highest priority and is set to `dev` by default in local configuration. If it is omitted, the application falls back to Next.js/Vercel's built-in environment values and recognizes a localhost `NEXT_PUBLIC_SITE_URL`. Any unsupported non-empty value safely selects `dev`. Existing pre-prefix records were created during development and are preserved in the `dev_*` tables. The initial `prod_*` tables are empty.

Every future database migration must apply the same structural change to both prefixes in one transaction. Prefer a loop over `array['dev_', 'prod_']` for mechanical changes. When SQL cannot be safely parameterized, write both explicit statements in the same migration. Do not change only one environment table set.

Foreign keys, uniqueness, checks, and RLS remain local to each environment. There are no cross-environment constraints or data-copy triggers.

## Branded authentication emails

The six Auth templates use Rein's common email design. Sources, generation instructions,
Supabase template variables, and hosted SMTP setup are documented in
[`docs/outreach/supabase-auth-email.md`](../docs/outreach/supabase-auth-email.md).
Local templates are configured in this directory's `config.toml`; hosted templates must be
updated separately without pushing localhost configuration into the shared project.
