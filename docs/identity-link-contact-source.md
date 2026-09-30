## Contact records created by an address check

When someone confirms a registered address that the organization has never
seen, the binding flow creates a `community_contacts` row so the address has
something to point at. That row uses `first_source = 'manual'`.

`identity_link` is deliberately not a new `first_source` value. That column
records how someone entered the community: a public registration, a
Contributor application, a resource submission, a GitHub contribution, a
director, a core contributor, or a manual record. Completing an address check
during account linking is not a new community entry, and adding a seventh
value would widen a constraint the earlier community migration defines and
that other code reads. `manual` is the existing category for a record a person
or a process created outside the public forms.

Where the link-specific origin matters, it is recorded in two other places:
the `rein_link_email_challenges.outcome` value, and the `admin_audit_log` row
written in the same transaction as `identity_link.email_verified`.

Creating this record grants nothing. No `member_count_events` row is written
and no `contributors` or `people` row is created, so a confirmed address alone
confers no membership, no Contributor standing and no governance right.
