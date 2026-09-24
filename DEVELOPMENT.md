# Website development guide

[简体中文](./DEVELOPMENT-zh.md)

This guide covers the website and community application for contributors working on the codebase. For the Foundation’s purpose and participation paths, see the [project README](./README.md).

## Architecture

- Next.js App Router, React 19, TypeScript, and plain CSS
- Supabase PostgreSQL, magic-link administrator authentication, RLS, and image storage
- Resend transactional email
- OpenAI Responses API with Structured Outputs and `omni-moderation-latest`
- Vitest for unit/component tests and Playwright for desktop/mobile flows

The warm paper palette, Newsreader/Manrope typography, institutional editorial layout, original URLs, and source-image credits are preserved from the prior Vite site.

## Routes

The institutional routes remain `/`, `/mission`, `/programs`, `/governance`, and `/giving`. Community routes are:

- `/community`
- `/community/people`
- `/community/learn`
- `/community/gather` and `/community/gather/[slug]`
- `/community/contribute`
- `/community/contribute/apply`
- `/community/contribute/resources/submit`
- `/community/code-of-conduct`
- `/privacy`

The unified private dashboard is at `/admin`.

## Local development

Use a current Node.js 22 or 24 runtime.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without external-service credentials, public content renders with truthful empty states and a zero all-time count. Forms are always visible and enabled; a submission displays a service error if its required backend is unavailable.

## Database setup

Apply the SQL migrations in [`supabase/migrations`](./supabase/migrations) in filename order. They create all entities, transactional registration/counting functions, retry functions, retention scrubbing, RLS policies, the restricted `community-images` bucket, raw-IP rate limiting, and Supabase Cron retention maintenance.

Development and production use the same Supabase project with isolated table sets. `DATABASE_ENVIRONMENT=dev|prod` is the highest-priority selector and defaults to `dev` in local configuration. When it is omitted, local runs, tests, and Vercel Preview use `dev_*`, while the production deployment uses `prod_*`. Every migration must update both sets in the same transaction. See [`supabase/README.md`](./supabase/README.md).

The migrations intentionally grant no anonymous form-table inserts. Validated Server Actions use the server-only Supabase Secret key, and anonymous access is limited to published resources, events, People profiles, event sessions, and the public aggregate metric.

## Runtime configuration

Forms do not use a launch flag and are enabled by default. Supabase is required to accept submissions and to use the administrator dashboard. Resend is required for verification and transactional email, while OpenAI is required only when an administrator explicitly starts an Agent review.

The scheduling URL, GitHub URLs, monitored public contact email, OpenAI model, and reasoning effort are managed in `/admin/settings`, not environment variables. The OpenAI API key remains a server-only environment secret. Supabase Cron runs retention maintenance inside the database, so no public cron route or cron secret is required. Community launch does not activate donations or fundraising.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js development |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm run lint` | Run Oxlint |
| `npm test` | Run unit and component tests |
| `npm run test:e2e` | Run Playwright desktop/mobile flows |
| `npm run build` | Create the production Next.js build |
| `npm start` | Serve the production build locally |
| `npm run test:e2e:data` | Run data-backed end-to-end flows |
| `npm run test:e2e:all` | Run both end-to-end suites |

## Agent and privacy boundary

Contributor processing sends only reasons, contribution interests, related “Other” text, general location, and optional industry to OpenAI. It never sends email or professional links and never crawls them. Requests use `store: false`, a hashed `safety_identifier`, the reasoning effort selected in `/admin/settings`, and a strict Zod output schema. Meetings are not recorded or transcribed and are never analyzed by the Agent.

Automatic rejection is limited to exact-evidence, high-confidence severe conduct. Administrators can restore the application, which disables the same automated closing path. OpenAI failure cannot roll back a registration, verification, count event, or manually reviewable record.

## Deployment operations

Submissions create durable Agent jobs without sending their content to OpenAI. After email verification where required, an administrator can explicitly start or retry an Agent review from the dashboard. Agent work never starts automatically from a public submission or a scheduled job. Daily retention maintenance runs within Supabase PostgreSQL. In the dashboard, administrators can resend verification, restore automated rejections, export formula-safe CSV, record Core Contributor nominations, and publish only consented profiles.

Do not seed fabricated courses, events, people, projects, or member records. Public empty states are part of the intended first release.

## Related references

- [Chinese local backend setup](./配置后端.md)
- [Database setup](./supabase/README.md)
- [End-to-end tests](./tests/e2e/README.md)
- [Brand assets and usage](./public/brand/README.md)

