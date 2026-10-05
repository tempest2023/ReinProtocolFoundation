## Address checks resolve existing contacts only

The binding flow never creates a `community_contacts` row. A confirmed address
must already belong to exactly one non-deleted contact. An unknown address moves
the link session to `registration_required`, records an audit event, and tells
the person to contact an administrator for community registration.

Completing an address check during account linking is not a new community entry,
so it does not write `first_source` at all. Registration remains a separate,
administrator-controlled process.

The result is recorded in `rein_link_email_challenges`. Successful verification
and `identity_link.registration_required` are also recorded in
`admin_audit_log` in the same transaction.

No `member_count_events`, `contributors`, `people`, `community_contacts`, or
`contact_identities` row is created for an unknown address. Email control alone
confers no membership, Contributor standing, role, or governance right.
