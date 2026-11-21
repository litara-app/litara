# ADR-0080: Let people choose a shorter browser sign-in

Status: Rejected
Date: 2026-11-19
Decision owner: Repository owner

## Context

[ADR-0041](0041-opaque-credentials-and-browser-session-profile.md) gives every browser session a persistent cookie that lasts 30 days idle and 90 days total. The owner asked for a "Remember me for 30 days" checkbox on the sign-in page. Today that choice cannot exist: every sign-in is already remembered, and `POST /auth/web/login` accepts no field for it (its body schema rejects unknown properties). Showing a working checkbox needs a contract and server change, which also changes an accepted lifetime profile.

## Decision

Rejected on 2026-11-19: the owner withdrew the request and asked for the sign-in checkbox to be removed, so every browser session keeps the ADR-0041 profile. The proposal below is retained for the record and is not implemented.

Original proposal: Recommendation: add an optional boolean `rememberMe` (default `true`, so existing clients are unchanged) to the web login body. When `true`, behavior is exactly ADR-0041. When `false`, the server issues a session cookie with no expiry (cleared when the browser closes) and a server-side idle deadline of 12 hours and an absolute deadline of 24 hours. Android and other bearer clients are unaffected.

## Alternatives

- Keep today's behavior and remove the checkbox.
- Accept `rememberMe` but only change the cookie (session cookie) and leave server lifetimes at 30 and 90 days, so a copied cookie stays valid for weeks.
- Different unchecked lifetimes (for example 1 hour idle for shared computers).

## Consequences

If accepted, `contracts/t003/openapi.json`, the generated OpenAPI check, `accounts.Service` and the cookie writer change together, with tests for both modes and for renewal never extending past the shorter absolute limit. The web client contained a checkbox behind a switch; it has been removed.

## Verification

Planned: login with `rememberMe` true and false asserts cookie attributes and stored deadlines; an unchecked session is rejected after 12 hours idle and after 24 hours absolute; the checked session keeps ADR-0041 deadlines; unknown field handling is unchanged for other bodies. Nothing here is implemented.

## Open questions

- Should the unchecked default be 12 hours idle and 24 hours absolute, or different values?
- Should the checkbox default to checked?
- Should an administrator be able to disable "remember me" server-wide?
