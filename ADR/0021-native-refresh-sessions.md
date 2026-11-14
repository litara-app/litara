# ADR-0021: Use rotating native refresh tokens with revocable device sessions

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The reference Android application refreshes through cookies. The new native client can adopt an explicit token transport under ADR-0009. Cast, downloads, and concurrent API calls can encounter expiry together.

## Decision

The user selected a rotating native refresh token stored in protected device storage, with per-device sessions and revocation. Native refresh must not require the old cookie transport. Web authentication handling is a separate contract and is not selected here.

## Alternatives

- Retain cookie-based refresh for native clients.
- Require manual login after every access-token expiry.
- Explicit rotating native refresh tokens and device sessions, as selected.

## Consequences

Store native credentials through supported protected device storage and avoid credentials in logs or ordinary caches. Rotation needs an explicit concurrency/retry/reuse policy so parallel refresh and lost responses do not create accidental logout. Network failure does not by itself establish invalid credentials. Session revocation must have defined effects on new requests and access-token lifetime.

## Verification

Planned: expiry, simultaneous requests, lost refresh responses, token reuse, explicit session revocation, logout, and temporary network outage. Verify one device's session handling does not incorrectly revoke unrelated devices. No auth implementation or TTL has been selected.

## Open questions

Token format and lifetime, refresh request/response shape, rotation/replay protocol, server-side storage, secure-storage implementation, revocation propagation, and web auth remain open.
