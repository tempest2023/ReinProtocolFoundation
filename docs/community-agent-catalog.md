# Member-only Agent catalog queries

The Website's resource and event catalog is also available through the existing authenticated
`POST /api/agent/operations` dispatcher. Nori uses this API for onboarding discovery instead of web
search or a hand-maintained copy of the catalog. Public website access remains unchanged.

## Authorization

All four operations require the separately assigned `community.read` service scope, a valid ingress
assertion bound to that caller, an allowed platform/workspace/channel, and the current sender's
verified Community Member link. Ordinary linked Discord and Slack members are eligible; Contributor
and Board roles are unnecessary. Governance scopes do not imply catalog access. Existing service
callers receive no new permissions automatically, and no schema migration is required.

The dispatcher resolves identity on every request, before querying data, and again before returning
it. Missing, expired or revoked links are refused. A link that changes contact while a query runs is
also refused. Neither request input nor conversation history can supply an actor or a membership flag.
The existing `ingress.relay` and identity scopes remain necessary for those independent endpoints.

## Operations

All requests retain `{ operation, input, proof: { kind: "assertion", assertion } }` and the existing
caller ID / Bearer headers. Proofs and credentials are never response fields.

| Operation | Input |
| --- | --- |
| `community_resources_search` | optional query, language, difficulty, topic, resourceType, limit, offset |
| `community_resource_get` | id (UUID returned by search) |
| `community_events_search` | optional query, city, format, startsAfter, startsBefore, limit, offset |
| `community_event_get` | id (UUID returned by search) |

Queries reuse the website's published-row query builders in `lib/community/queries.ts` and its
environment-scoped public client. They read `resources`, `events` and `event_sessions`, with no new
catalog table, database credentials in Nori, publication writes or registration actions. Filters
run before pagination. `query` matches literal title/summary substrings; language, difficulty and
city also use case-insensitive literal substrings. topic matches an exact array tag. LIKE
metacharacters and raw PostgREST logic punctuation cannot add predicates. Unknown input is rejected.

Page size defaults to 3, maximum 20, offset 0–10000. One lookahead row produces hasMore/nextOffset.
Resources use editorial order, published_at descending, id; events use created_at descending, id.
Event pages are not sorted globally by nearest session. Future event searches use a joined session
filter, startsAfter inclusive (default: backend current instant), startsBefore exclusive. Timestamps
require explicit UTC offsets; event IANA timezones and stored registration status are preserved.
Search returns matching sessions; event detail returns every session. Only publication_status=published
is visible, excluding cancelled, draft and archived records even by direct ID. Closed/full registration
is returned truthfully and does not imply the member can register.

Success is `{ ok: true, operation, result }` where result includes ok, status (`found`, `empty`,
`not_found`), source (`foundation_catalog`), environment, retrievedAt, items, hasMore and nextOffset.
Events search also returns the effective time window. Records include canonical links, updatedAt,
and resource access verifiedAt. These are database facts, not a live crawl of external websites.
Explicit projections exclude submitters, access verifiers, approval references and image permission
notes. Null/absent metadata is not inferred. Membership/contact IDs stay inside the dispatcher.

Errors use the existing closed machine reasons: 403 binding_not_verified/identity_revoked for member
eligibility, caller/scope/platform/channel errors for other permission failures, 400 invalid_request,
and 503 unavailable for data failures. Unlike the public page's graceful empty state, a failed catalog
read never masquerades as no matches. Successful responses use Cache-Control: no-store. Environment
comes from the existing backend database configuration; input cannot switch it.

## Validation and rollout

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Focused tests are
`tests/community-catalog.test.ts`, `tests/community-resources-data.test.ts` and
`tests/agent-operations-route.test.ts`. The route tests exercise real caller/proof/identity validation
with synthetic backing stores, including a revoked link between calls and during a read.

Deploy the backend change before enabling the corresponding Nori tools. Assign `community.read`
only to the intended registered caller and retain its platform/channel allowlists. A development
catalog result is not a production query; record real-data acceptance separately from unit tests.
