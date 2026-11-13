# ADR-0002: Build the replacement backend in Go

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Current Litara uses NestJS and Prisma. BookOrbit also uses a TypeScript server. The user requested reimagining Litara from scratch with a Go backend, then authorized starting the rebuild.

## Decision

Implement the active replacement backend in Go. Preserve the old server as reference rather than incrementally converting its application modules.

## Alternatives

- Extend the existing NestJS backend.
- Fork BookOrbit's server.
- Rebuild in Go, as selected by the user.

## Consequences

Existing TypeScript server libraries are not automatically reusable in Go. Go alone does not provide format extraction, reliable jobs, offline sync, or performance guarantees. Router, SQL access, migrations, helper processes, and worker topology remain undecided.

## Verification

The active backend must build and test using the selected Go toolchain once implementation begins. Any external runtime requirement needs an explicit decision.

## Open questions

Framework, SQL tooling, and process topology are pending ADR-0008 and later implementation choices.
