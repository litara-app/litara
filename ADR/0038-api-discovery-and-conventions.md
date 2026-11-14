# ADR-0038: Use one versioned API, discovery and pagination convention

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0009 accepts a documented open versioned API, ADR-0018 accepts stable opaque IDs, and ADR-0024 selects Huma/OpenAPI. The original Android audit observed several incompatible pagination/error conventions.

## Decision

The user accepted these conventions on 2026-11-13:

- Public API routes use `/api/v1`. Public unauthenticated discovery reports stable server identity and supported API versions.
- Resource IDs are opaque UUIDs; they are not filesystem paths or access grants.
- Collection pagination consistently uses zero-based `page` and `size`, default size 50 and maximum 200, with total counts and the effective size in responses.
- Errors are typed standard responses that clients can distinguish without parsing human-readable text.
- The development API is explicitly unstable until production; v1 becomes a compatibility commitment at production.

No official-app attestation gate is introduced.

## Alternatives

- Mixed pagination conventions inherited from BookOrbit.
- Cursor-only pagination without totals.
- A consistent versioned page/size contract with totals, as selected.

## Consequences

Clients must use the effective page size, deterministic ordering and a stable tie-breaker. Development-breaking changes must be documented as unstable rather than advertised as production-compatible. Public discovery must not disclose users/library contents. API documentation and shared fixtures need exact request/response shapes before implementation; this choice does not independently select a UUID version, endpoint suffix or error extension name.

## Verification

Test a third-party client without official-app identity, server identity across URL changes, no private discovery data, page boundaries/caps/totals, deterministic ordering and typed errors. Validate OpenAPI against the implemented contract. Planned for T003.

[Huma error documentation](https://huma.rocks/features/response-errors/) documents its RFC 9457 problem-details model; that is a compatible candidate for the selected standard typed errors, not an additional user-selected wire format yet.

## Open questions

Exact discovery fields/path, UUID generation version, typed error fields/status matrix and client generation must be documented as contract/implementation details within these conventions. Production compatibility/deprecation duration remains release-policy work. Page-based results may move under concurrent catalog changes; snapshot pagination is not selected.
