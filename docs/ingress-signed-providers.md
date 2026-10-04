# Signed Platform Ingress

How the Slack and Discord ingress endpoints authenticate a delivery, which service principal a
delivery is attributed to, and what each endpoint answers.

## Two modes

Slack and Discord sign their own deliveries and cannot send Rein-specific headers. A direct webhook
is therefore authenticated by the platform signature alone, and the enrolled service principal has
to come from server-owned configuration rather than from the request.

- Direct mode: the request carries no caller-id or authorization headers. After the raw-body
  signature verifies, the caller is taken from a server-owned environment variable and loaded
  without a credential. The verified signature is the authentication.
- Forwarded mode: the request carries the service headers, as an API proxy re-delivering a platform
  event would. Those headers are honoured strictly. A present-but-invalid forwarded credential is
  refused, never silently downgraded to direct mode, and no environment caller is consulted.

In both modes the caller must exist, be enabled, hold the ingress.relay scope, and allow the
platform/workspace and channel derived from the signature-verified body. A revoked caller has no
path back in. Nothing in the request body can choose or widen the caller.

## Configuration

- REIN_SLACK_SIGNING_SECRET: Slack app signing secret; verifies the v0 signed body.
- REIN_DISCORD_PUBLIC_KEY: Discord application public key (32-byte hex); verifies the Ed25519 body.
- REIN_SLACK_HTTP_CALLER_ID: enrolled caller id used for direct Slack deliveries; empty refuses them.
- REIN_DISCORD_HTTP_CALLER_ID: enrolled caller id used for direct Discord deliveries; empty refuses them.

A missing signature secret or public key answers 503 not_configured. A missing caller id refuses only
direct deliveries; forwarded deliveries do not consult it.

## Responses

- Slack url_verification: 200 with the challenge, after the signature verifies.
- Slack event: 200 with an ok receipt and expiry in direct mode, or the full forwarding receipt when
  forwarded.
- Discord PING: 200 with type 1.
- Discord interaction: 200 with type 5 (a valid deferred acknowledgement) in direct mode, or the
  forwarding receipt when forwarded.
- Bad or replayed signature: 401 bad_credential.
- Workspace or channel outside the allowlist: 403 platform_not_allowed or 403 channel_not_allowed.

## What a verified delivery produces

A verified delivery mints one short-lived (five-minute) ingress assertion bound to the resolved
caller and the derived platform tuple, and stores it as the event receipt. The assertion is reusable
until it expires, and one assertion per verified event is deduplicated, so a repeater cannot mint
unbounded proofs.

## Scope of this endpoint

This endpoint is a transport, not the Agent bridge. It verifies the platform, attributes the
delivery to an enrolled caller, and records the receipt. The Agent's own traffic continues to use the
enrolled relay endpoint, which requires the service headers and the ingress.relay scope and mints the
proof the runtime presents. Direct signed HTTP does not by itself make the Agent reachable in a
channel.
