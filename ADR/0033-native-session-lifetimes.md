# ADR-0033: Bound native access and refresh-session lifetimes

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0021 accepts rotating native refresh tokens and revocable per-device sessions; concrete lifetimes were open. T003 needs expiry behavior that distinguishes authorization failure from ordinary network interruption.

## Decision

The user selected these limits on 2026-11-13:

- Native access tokens expire after 15 minutes.
- A rotating native refresh session expires after 30 days without use or 90 days total, whichever comes first. Successful use may renew the idle deadline but never extend the absolute deadline.
- Devices can be revoked individually. Ordinary network failures keep the user signed in rather than being treated as invalid credentials.

These limits do not by themselves select a token format or refresh replay/concurrency protocol.

## Alternatives

- Keep sessions until logout/revocation.
- Apply access, idle and absolute limits, as selected.

## Consequences

Session records need separate idle and absolute deadlines. Clients should request sign-in again for definitive session expiry/revocation, retain account-scoped unsent work, and avoid logging out merely because a network request failed. ADR-0032 separately permits locked-account offline data retention; session expiry does not authorize deleting files.

## Verification

Test just-before/at expiry boundaries, idle renewal without moving the absolute deadline, one device revoked without affecting another, and transient transport failures without credential deletion. Planned for T003; no runtime auth implementation exists in this decision session.

## Open questions

Token format, refresh retry/revocation, successful-use idle renewal and browser lifetimes are now selected in ADR-0036/0037/0041. Exact wire names and implementation details must be documented in the T003 contract; production cleanup scheduling remains operational work.
