# ADR-0003: Start with fresh application data and client contracts

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Preserving Litara's database or old clients would constrain identifiers, schemas, passwords, reading state, and API behavior. The user explicitly selected: Start fresh; keep the old stack only as a reference.

## Decision

Do not require migration of existing Litara data or compatibility with its old API and clients for the initial release. Keep the archived stack available as a behavior reference. Existing book files may be indexed without importing old application state.

## Alternatives

- Migrate existing data while replacing the API.
- Preserve data and existing clients.
- Start fresh, as selected.

## Consequences

Users recreate accounts and application state. This does not authorize deleting existing files, databases, credentials, or reading history. ADR-0005 separately selects a different Android application as the mobile starting point; its useful behavior must be preserved without requiring its existing server contract to remain unchanged.

## Verification

A new installation must initialize without the old database. Do not include an implicit old-database migration or require archived services to run.

## Open questions

None within this record's scope. Future optional imports would be a separate decision.
