# ADR-0009: Publish a versioned API for first- and third-party clients

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The Android reference mirrors BookOrbit endpoint shapes by hand. Its README reports official-app attestation restrictions as its reason for ending maintenance. Emulating that API indefinitely would constrain the new backend.

## Decision

The user selected a documented, versioned Litara API open to third-party clients. Adapt Android networking and models to Litara while preserving its media behavior. Do not require BookOrbit endpoint compatibility or official-app identity as an ordinary client access condition. Authentication and permissions still apply equally to clients.

## Alternatives

- Emulate the Android app's existing BookOrbit endpoints initially.
- Support only first-party clients.
- Publish a Litara contract and adapt clients, as selected.

## Consequences

API evolution becomes a compatibility commitment. Document auth, pagination, error shapes, progress, downloads, and media delivery. Code generation and the precise compatibility/deprecation policy are not yet selected.

## Verification

Planned: a client with no official package identity can authenticate and use permitted endpoints; Android integration tests exercise the new contract, including media seeking and auth expiry. Document breaking versus additive changes before publishing a stable API.

## Open questions

Contract tooling, compatibility window, client generation, and token/session design remain open.
