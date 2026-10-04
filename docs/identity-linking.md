# Identity Linking

This document describes how Rein Protocol links a chat-platform account to an organizational
identity, what the linked record proves, and which parts of the flow are implemented in this
repository today. It covers the design contract, the two website pages that carry a person through
the email step, and the limits of the current implementation.

## Two proofs

A link is established by two independent proofs, and neither one is sufficient alone.

1. **Email receipt proves control of an address.** The person asks for a link from
   `/community/link/[session]`, and a message with a one-time receipt link is sent to the address they typed.
   Opening that link (`/community/link/confirm`) returns the receipt to the server, which shows that
   whoever holds the link can also receive mail at that address. The receipt is a possession proof:
   the emailed link is the only place the raw value appears, and no API response or rendered page
   returns it.
2. **A short-lived binding code typed back in chat proves control of the platform account.** After a
   successful confirmation, the browser is shown a one-time binding code. The person gives that code
   to the Agent in the chat platform they want to link. The Agent submits the code from a request
   that carries the platform account, so the same person has now demonstrated control of both the
   address and the account.

Neither proof is accepted as standalone authority, and neither one is a credential that can be
replayed later: the receipt works once, and the binding code expires quickly (see the provisional
defaults below).

## The website pages

| Path | Purpose |
| --- | --- |
| `/community/link/[session]` | Accepts an address and requests the receipt link. Shows a generic sentence after submission. The opaque session is a path segment so chat-runtime query-parameter redaction cannot corrupt the link. |
| `/community/link` | Backward-compatible query entry and invalid-link fallback; new binding responses use the path form above. |
| `/community/link/confirm` | Takes the opaque session and receipt values from the URL and confirms the address. Displays the binding code on success. |

Both pages are excluded from search indexing and are reachable only through a session or receipt
value handed to the person by the Agent. The initial request always receives the same response, so
it cannot be used to test whether an address exists. Only after the person proves mailbox control by
opening the one-time receipt may the confirmation explain that the address is not registered and
that an administrator must register it before linking.

The pages collect only the email address (first step) or the opaque values already present in the
URL (second step). No numeric code is entered on the website, and no internal identifier, hash,
table name, or token is ever displayed.

## The binding record

- A binding row is a **platform, workspace, and platform-user tuple** together with the contact it
  points at, its status, and its timestamps.
- That tuple is **unique across statuses**. A revoked row keeps its place in the table instead of
  being deleted, so a later attempt to bind the same platform account does not silently create a
  second row. The revoked row is a **tombstone**: an administrator has to clear or re-verify it
  before that platform account can be linked again.
- A binding is valid only while its status is verified. Revocation is the normal way to end a link;
  it never deletes historical contributions or records tied to the contact.
- **P0 permits one verified Slack identity per contact.** A second Slack tuple for the same contact
  is refused, including when two completions race. Supporting account migration or multiple Slack
  accounts is deferred to P2. Other platforms remain separately scoped and do not confer Slack
  governance rights.

## Registered contacts only

A verified address identifies an existing, non-deleted contact. If the address is unknown to the
organization, the session enters `registration_required`, no contact or identity row is created, and
the person is directed to an administrator. Email control alone never registers a community member
and grants no membership, Contributor status, role, or governance right.

## Authority, scopes, and re-derivation

- Private governance reads and all writes go through `POST /api/agent/operations`, using a
  registered service caller with a per-operation scope. That endpoint is the single private surface
  for these operations; nothing else is allowed to read governance data or change it.
- Human eligibility is **re-derived on the server on every write**. A caller cannot assert a role,
  weight, or eligibility, and an earlier confirmed result is not reused as authority for a later
  operation.
- The Agent never sends a raw platform user identifier as authority. A platform account identifier
  is an input to be matched against the binding record, never a claim that the caller has already
  been proven to be that person.
- Assertions are short lived. Any statement that a caller is a particular linked person carries a
  near-term expiry and has to be re-established for later operations.
- Chat text that claims an email address or role is untrusted. Neither the Agent nor these APIs accept
  a target email, contact id, role, platform user id, or workspace id from a model-authored binding
  request. The email is entered only on the website and proved by its one-time receipt.

## Ingress and relay

Two enrollment paths exist for platform traffic, and they are not interchangeable:

- **HTTP-signed ingress endpoints** verify a request signature from the platform before any content
  is trusted.
- **The relay** is used only for platforms or workspaces that are **explicitly enrolled** with it.
  Enrollment is a deliberate configuration step, not a fallback for a signature that cannot be
  checked.

Both paths are treated as untrusted transport. Whatever they deliver still has to pass the same
binding and eligibility checks as any other request.

## Provisional defaults

These values are provisional and are stored per row, so they can be adjusted without a schema
change:

| Value | Provisional default |
| --- | --- |
| Binding validity | 10 years |
| Binding code time to live | 10 minutes |

## Current integration boundary

- Discord binding and multiple-Slack-account migration are not part of P0.
- Automated tests mock email delivery; live sandbox tests require separately configured email and
  platform infrastructure and must use synthetic accounts.
- This repository contains the identity-linking domain logic (`lib/identity/linking.ts`), the
  registered-caller and scope contract (`lib/agent/contracts.ts`, `lib/agent/service-callers.ts`),
  signed-ingress and assertion verification (`lib/agent/assertions.ts`), the governance reader and
  writer (`lib/agent/governance/`), the database migrations under `supabase/migrations/`, and the
  two website pages described above, and the `POST /api/agent/operations` dispatcher
  (`app/api/agent/operations/route.ts`) that carries every private governance call. Its writes run
  through the guarded governance RPC described below. What is still not wired to a live platform is
  reachability rather than the code path. A controlled development Slack workspace and transactional
  mail path were exercised on 2026-10-03; production Slack/Discord enrollment and production mail
  remain deployment configuration rather than repository defaults.

## Related reading

- `docs/PRD-agent-community-operations.md` (R02) states the identity and eligibility requirement.
- `lib/agent/governance/reader.ts` documents the read-only table contract and the fail-closed rules
  used when an email lookup is available.
## In-flight semantics for revocation

Completion and revocation serialize on the platform tuple: the completion
function takes a transaction-scoped advisory lock on the tuple and then the row
lock, and revocation takes the row lock on the same link. A revocation that
commits before a completion is therefore visible to it and refuses it, and a
completion that commits first leaves a live row for the revocation to read.

The governance writes under `/api/agent/operations` (`submit_proposal`,
`create_poll`, `cast_ballot`, `finalize_poll`, `record_proposal_revision`,
`approve_proposal_revision`, `apply_proposal_revision`) close the same window at
the database. Each one runs through one security-definer function,
`<env>_rein_guarded_write`, defined in
`supabase/migrations/20260930140000_rein_governance_guarded_write.sql`. In a
single transaction it locks the caller row, revalidates the caller status, the
registration scope, the assertion digest and its expiry, the platform and channel
allowlists, then locks the canonical platform-link row, and only then performs
the mutation. Revocation takes that same link-row lock, so a revocation that
commits before a write is visible to it and refuses it, and a write that commits
first leaves a live row for the revocation to read. The actor is derived from the
locked link row rather than trusted from the request, and the guard refuses a
contact id that disagrees with it.

Expiry is re-read with `clock_timestamp()` rather than `now()`, because this
transaction can block on the caller and link row locks: `now()` is the
transaction start time, so a proof or link that was live when the call began
could otherwise be admitted after it has expired. The binding-completion function
keeps the same rule and re-checks the session and binding-code expiry after the
last wait, immediately before it consumes the code.
