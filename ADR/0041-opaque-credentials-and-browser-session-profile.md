# ADR-0041: Use opaque credentials and a protected browser session profile

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADRs 0033, 0036 and 0037 select session lifetimes, refresh retry/revocation and browser cookie transport but leave token format and browser lifetime/transport attributes open.

## Decision

The user accepted this profile on 2026-11-13:

- Native access and refresh credentials are random opaque secrets backed by server-side session records, rather than self-contained signed JWT access tokens.
- Store native credentials in protected Android storage.
- Browser session cookies use HttpOnly, Secure and SameSite=Lax with the CSRF checks selected in ADR-0037.
- Browser sessions expire after 30 days idle or 90 days total.
- HTTPS is required normally; explicitly enabled development-only HTTP is allowed.

Per-device native sessions, immediate checks on new requests and refresh retry rules remain governed by ADR-0033/0036.

## Alternatives

- Self-contained signed JWT access tokens.
- Opaque server-backed credentials with one browser lifetime profile, as selected.

## Consequences

Generate secrets with a cryptographically secure generator, store credential verifiers rather than reusable raw secrets in ordinary session rows, and keep refresh recovery responses protected and bounded to 60 seconds. A server-side lookup enforces account/session validity on every new request; do not extend idle deadlines on unauthorized or replay requests. Browser/native idle deadlines renew on successful authenticated session use, bounded by absolute expiry. HTTP development mode must be explicit in server/client configuration, never an automatic fallback after TLS failure; document the necessary development cookie exception rather than silently disabling Secure in normal mode. No credentials in URLs or ordinary logs.

## Verification

Test opaque secret handling, expiry/idle limits for native and web, browser cookie attributes, CSRF checks, session revocation and explicit HTTP-mode boundaries. Test that retry recovery is unavailable from a revoked session and cannot expose credentials outside its session/token/request scope. Planned for T003.

## Open questions

Exact cookie names, protected recovery storage implementation, local development configuration and login rate-limit parameters are contract/implementation details to document and review. Production deployment TLS termination and session cleanup scheduling remain operational work.
