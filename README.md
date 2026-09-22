# Rein Protocol Foundation

Rein Protocol Foundation is a public-benefit institution advancing AI Agents that create measurable social value while remaining transparent, governable, and accountable to people. This repository contains its institutional website, public community experience, and private operating dashboard. The organizational source of truth remains [PROJECT.md](./PROJECT.md).

## Product requirements

- Agent-operated community PRD: [English](./docs/PRD-agent-community-operations.md) · [中文](./docs/PRD-agent-community-operations-zh.md). Planned OpenClaw-based community operations, including Contributor proposals, Board voting, event coordination, reporting, and publishing. These are product requirements drafts, not statements of currently implemented capabilities; proposed policy defaults remain subject to confirmation.

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

## Agent and privacy boundary

Contributor processing sends only reasons, contribution interests, related “Other” text, general location, and optional industry to OpenAI. It never sends email or professional links and never crawls them. Requests use `store: false`, a hashed `safety_identifier`, the reasoning effort selected in `/admin/settings`, and a strict Zod output schema. Meetings are not recorded or transcribed and are never analyzed by the Agent.

Automatic rejection is limited to exact-evidence, high-confidence severe conduct. Administrators can restore the application, which disables the same automated closing path. OpenAI failure cannot roll back a registration, verification, count event, or manually reviewable record.

## Deployment operations

Submissions create durable Agent jobs without sending their content to OpenAI. After email verification where required, an administrator can explicitly start or retry an Agent review from the dashboard. Agent work never starts automatically from a public submission or a scheduled job. Daily retention maintenance runs within Supabase PostgreSQL. In the dashboard, administrators can resend verification, restore automated rejections, export formula-safe CSV, record Core Contributor nominations, and publish only consented profiles.

Do not seed fabricated courses, events, people, projects, or member records. Public empty states are part of the intended first release.

## Brand and production

- Repository: https://github.com/tempest2023/ReinProtocolFoundation
- Planned production hostname (release pending approval): https://rein-protocol-foundation.vercel.app
- Current production: https://beneficence-protocol.vercel.app
- Brand assets and usage: [public/brand](./public/brand/README.md)

The existing production project is renamed in place, retaining its project ID and data. The previous Vercel hostname remains a compatibility entry point for existing links and authentication callbacks. `NEXT_PUBLIC_SITE_URL` retains its existing production value pending approval of the URL migration. Historical SQL migrations, the local Supabase project ID, and the stored `Beneficence-hosted` event classification intentionally retain their identifiers; the UI presents that classification as `Rein-hosted`. “Beneficence” in the founding proposition refers to the ethical principle.
