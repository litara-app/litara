# ADR-0024: Use Huma, sqlc/pgx, Goose, and River for the Go backend

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

ADR-0016 selects a modular Go application with PostgreSQL-backed jobs but leaves implementation tools open. The replacement needs documented APIs, explicit SQL, incremental migrations, and recoverable work without another deployed queue service.

## Decision

The user accepted standard Go `net/http` with Huma for validated JSON APIs and generated OpenAPI, sqlc with pgx for PostgreSQL access, Goose for application migrations, and River's open-source core for durable jobs. Run bounded workers in the application. No Redis or separate worker deployment is required initially.

## Alternatives

- A full ORM instead of SQL-first data access.
- Handwritten HTTP contracts, SQL mapping, and job infrastructure.
- The selected typed API/SQL tooling and existing job library.

## Consequences

Use SQL as the query/schema source rather than maintaining a competing ORM model. Streaming routes must preserve raw HTTP semantics and share authorization with JSON routes; Huma serialization must not wrap media bytes. River jobs may retry, so filesystem and provider operations still need idempotency, cancellation, and recovery logic. Coordinate River's own schema migration with application migrations without editing third-party migration history. Pin reviewed versions when bootstrapping. First-party source remains MIT; dependencies retain their own licenses, including River's MPL-2.0.

## Verification

Planned: validate OpenAPI against implemented JSON and media operations; compile generated SQL; initialize/upgrade a database; atomically commit application changes and queued work; interrupt workers and recover without duplicate effects. Verify worker bounds, cancellation, and failed migration behavior. Documentation review is complete; the backend has not been scaffolded or tested here.

## Open questions

Exact versions, minimum PostgreSQL version, migration startup/command policy, API conventions/client generation, queue-specific retry/cancellation/retention, and package layout remain open.

## References

- [Huma with standard HTTP](https://huma.rocks/tutorial/your-first-api/)
- [sqlc and pgx](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html)
- [Goose](https://github.com/pressly/goose)
- [River](https://github.com/riverqueue/river)
