# ADR-0008: Use PostgreSQL as the application database

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Both reference servers use PostgreSQL. A single-file database would simplify installation, while two database engines would expand query, migration, and verification work.

## Decision

The user selected PostgreSQL: an application plus database deployment with room for concurrent jobs. Do not require SQLite support in the first release.

## Alternatives

- SQLite for a single-container installation.
- PostgreSQL, as selected.
- Both from the first release.

## Consequences

Installation requires a database service. Database files and application state stay on local storage under ADR-0007. PostgreSQL availability alone does not decide job queue design, process topology, SQL generation, or search extensions.

## Verification

Planned: initialize a new database, apply incremental migrations, exercise concurrent catalog/state updates, and verify backup/restore before release.

## Open questions

Supported database versions, SQL access and migration tools, job persistence implementation, and optional extensions remain open.
