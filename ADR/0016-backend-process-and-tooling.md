# ADR-0016: Choose backend process topology and implementation tools

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Go and PostgreSQL are accepted, but framework, SQL tooling, jobs, and helper runtimes are not. The old server starts some long tasks directly in process while recording their status in the database.

## Decision

The user selected one modular Go application with durable PostgreSQL-backed jobs and bounded workers. Scans, enrichment, and imports must recover after restarts. A dedicated external message queue or separately deployed workers are not initial requirements. Choose SQL/migrations and document any media extraction helpers separately.

## Alternatives

- A single service with in-memory background work.
- A modular service with durable jobs.
- Separate API/workers and a dedicated queue from the outset.

## Consequences

The process topology is accepted; no router, SQL, migration, or job library has been selected. A single process does not excuse lost jobs; durable records alone do not guarantee safe retries. Media helpers can affect image size and installation requirements. Retries and cancellation require operation-specific semantics.

## Verification

Planned: interrupt scans/imports/enrichment, restart, verify safe recovery, and test duplicate claims and cancellations without duplicate writes or catalog corruption.

## Open questions

ADR-0024 now selects HTTP/API, SQL, migration, and job libraries. Job-specific claim/retry/cancellation semantics, migration deployment policy, and observability remain open. ADR-0028 selects bundled native ffprobe/FFmpeg, superseding the WASM evaluation-first approach; exact packaging and conversion behavior remain open.
