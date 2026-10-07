# Admin interface languages

The administrator interface supports English (`en`, the default) and Simplified Chinese (`zh`).
The native language dropdown is available on the login page and in the dashboard sidebar,
including its mobile layout. It uses the website's typography, color tokens, and restrained
underline styling, with keyboard support and a disabled state while saving. It preserves the
current route and filters. The public website is unchanged.
The dashboard's missing-record page also follows the selected language.

The validated preference is stored for one year in the HTTP-only `rein_admin_locale` cookie,
scoped to `/admin`. Server Components read it through `getAdminI18n()`. The root Admin layout
passes the same language to `AdminI18nProvider` so server and client rendering agree. Changing
the cookie with a Server Action re-renders the current route; no localized URL structure,
database changes, external translation service, or additional dependency is required.

English source messages and Chinese translations live in `lib/admin/messages.ts`. Use
`t('English message')` for interface copy and `t('Message with {value}', { value })` for
interpolation. Use `label(value)` only when displaying a known record enum or source, never
for an input value or action argument. Unknown messages remain unchanged. Dates and numbers
use the selected `en-US` or `zh-CN` locale; existing event timezone handling is retained.

Keep option `value`, input `defaultValue`, database enum values, action IDs, model IDs, URLs,
and identifiers unchanged. User-authored titles, descriptions, biographies, review notes,
and structured Agent/audit output are not machine-translated. Server Action messages are
translated at the client presentation boundary so existing feedback follows language changes.

Checks: `npm test`, `npm run typecheck`, `npm run lint`, and
`npx playwright test tests/e2e/admin-i18n.spec.ts`. The language-switch browser test does not
submit a login request, send email, or mutate application records.
