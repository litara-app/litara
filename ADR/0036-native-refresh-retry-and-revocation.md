# ADR-0036: Make native refresh retries idempotent and revoke reused sessions

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0021 requires explicit refresh concurrency/retry/reuse semantics, and ADR-0033 fixes native lifetimes. Concurrent requests or a lost response must not rotate credentials twice or accidentally revoke every device.

## Decision

The user accepted this protocol on 2026-11-13:

- Serialize refreshes per device on the client.
- Assign a request ID to each refresh exchange. A lost response can be retried with the same ID for 60 seconds, returning the same successful exchange rather than rotating again.
- Reusing an old refresh token with a different request ID revokes only that device session.
- Validate server-side session state on each authenticated request so logout/revocation blocks new requests immediately.

Server handling must be transactional under concurrent calls. The 60-second retry exception is specific to the original token/session/request ID; matching an arbitrary ID is not authorization.

## Alternatives

- Reject every old-token retry and force sign-in even after a lost response.
- Permit a bounded identical-exchange replay, as selected.
- Long grace periods or account-wide revocation are not selected.

## Consequences

Native credentials remain protected on device. Replay records need bounded secure handling sufficient to recover the identical exchange for 60 seconds; they must not turn into unbounded plaintext credential storage. Do not extend session expiry during a replay or return credentials from a revoked/expired session. An old token retry after the 60-second recovery period must not mint another exchange; exact response classification is still to be frozen with the token protocol. An immediate revocation guarantee applies to new requests, not bytes already delivered or a disconnected client.

## Verification

Test simultaneous refresh, lost response with an identical ID, different-ID reuse, revoked-session retry, expiry boundaries and request after logout. Verify replay does not extend deadlines or revoke unrelated sessions. Planned for T003.

Reference: [RFC 9700 section 4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14) describes rotation/reuse detection. The specific 60-second idempotency recovery rule is a Litara decision, not a requirement copied from that standard.

## Open questions

ADR-0041 now selects opaque server-backed credentials and the browser/native profile. HTTP fields, protected replay response storage and the post-window typed error are contract/implementation work within the accepted retry policy. No immediate termination of already-open streams is promised; new requests must revalidate.
