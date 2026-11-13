# ADR-0037: Use protected same-origin browser session cookies

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0021 selects native refresh transport but explicitly leaves web auth open. A shared client contract must not silently adopt browser local-storage credentials just because native clients use bearer tokens.

## Decision

On 2026-11-13 the user selected a same-origin protected browser session cookie with CSRF checks on changes. Browser bearer-token storage is not selected. Android and third-party native/API clients keep bearer authentication.

## Alternatives

- Bearer tokens in browser storage.
- A same-origin protected browser session cookie with CSRF checks, as selected.

## Consequences

Use HttpOnly cookies, Secure cookies on supported HTTPS deployments, an explicit SameSite policy and CSRF protection for state-changing cookie-authenticated requests. Do not expose browser session credentials in JavaScript or URLs. Browser and native sessions must enforce identical library/account permissions. Cross-origin credentialed browser APIs are not authorized by choosing same-origin auth. Cookie attributes and development transport exceptions need an explicit protocol/deployment specification before implementation.

## Verification

Test login/session persistence, logout, CSRF rejection, origin checks, inaccessible cookie credentials from JavaScript and parity with bearer authorization. Planned for T003’s API foundation; complete web UI belongs to T005.

## Open questions

ADR-0041 now selects browser idle/absolute lifetime, cookie attributes and explicit development-only HTTP. Exact cookie/CSRF wire names and development configuration remain contract/implementation work; production deployment TLS setup remains operational work.
