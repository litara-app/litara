# ADR-0030: Consolidate pre-production application migrations into init

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

T001 introduced two Goose migrations to demonstrate initialization and an incremental upgrade. Litara is a fresh rebuild with no production schema compatibility requirement yet. The user requested: "Starting from scratch so want everything in init until ready for production" on 2026-11-13.

## Decision

Until the application is ready for production, consolidate first-party PostgreSQL schema changes into a single Goose init migration. Fold the current inspection schema, tool provenance column and state index into that migration. Before production, freeze the baseline and begin immutable incremental migrations for subsequent changes. This supplements ADR-0024's tool selection and resolves the pre-production history policy; it does not select production migration execution automation.

River's own migration history remains managed by River and is not copied, rewritten or squashed into application SQL.

## Alternatives

- Retain incremental migrations throughout development, including the demonstration-only v1 to v2 upgrade.
- Consolidate the application schema until production readiness, then preserve upgrade history, as selected.

## Consequences

Developers must initialize a fresh development database after init changes; Goose does not replay already-applied migration version 1. Existing local databases are not reset automatically and user data must not be deleted by tooling. Compatibility with the earlier pre-production two-migration schema is not promised. Replace the synthetic upgrade demonstration with initialization and data-preserving repeat-invocation checks. Existing production requirements for durable jobs and preserved library files remain unchanged.

## Verification

Verify a fresh database applies exactly application version 1, includes the tool provenance column and state index, and has current River migrations. Repeating the migration command must apply no application changes and preserve existing request/result data. Verify sqlc output, backend integration checks and fresh-container smoke. Structural ADR validation is required after this record/index edit.

## Open questions

The concrete production-readiness milestone and production migration execution policy remain open. This record does not authorize automatic database resets or rewriting River migrations.
