# ADR-0050: Reconcile OS-mounted libraries without destructive absence handling

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0007 selects NAS book folders with local application/database state but leaves access, scheduling, stability and missing-root behavior open. Filesystem notifications and transient empty/unavailable mounts cannot safely establish deletion.

## Decision

The user selected the following on 2026-11-13:

- Use operating-system-mounted SMB/NFS directories; keep PostgreSQL/application state local. T004 does not implement direct SMB/NFS login clients.
- Target Linux/container mounts and Windows SMB; claim support only for configurations actually tested.
- Treat filesystem events as hints and run configurable full reconciliation scans, default every 15 minutes.
- Before hashing/inspection, require unchanged size and modification time across two observations at least 30 seconds apart.
- If root identity/health fails or the root is unavailable, retain catalog/history and mark it unavailable.
- Mark individual files missing only after two successful healthy scans confirm absence; never automatically delete catalog records or source files.

## Alternatives

- Direct network-protocol clients in the application.
- Events alone, or scheduled-only scans.
- Immediate missing/deletion on an incomplete listing.
- Mounted shares with event hints, periodic reconciliation and conservative absence confirmation, as selected.

## Consequences

A readable directory alone may be an unmounted local mountpoint; root health must validate the configured library identity before absence reconciliation. A failed/partial scan never increments healthy absence confirmation. Preserve history and original metadata when a file becomes missing; reappearance can restore availability without inventing new identity. The stability window reduces partial-copy exposure but is not proof the writer has finished: recheck metadata around hashing/probing/copying and retry changing files. Coalesce overlapping scans under durable jobs and bounded I/O; notifications do not bypass stability or grant checks. No NAS/database-volume support is implied.

## Verification

Planned for T004: missing notifications, event storms, changed files, growing partial copies, unmounted/incorrect root, incomplete listing/errors, two healthy absence scans, disconnect/reconnect, reappearance and durable restart. Name tested OS/container/mount protocol/server versions; simulated tests do not establish a real NAS support claim. No such runtime/hardware verification occurred in this decision session.

## Open questions

ADR-0059 now selects explicit root health identity and default symlink exclusion; ADR-0058 selects the fingerprint/cache policy. Actual NAS support and safe writable replacement capabilities remain evidence requirements, not presumed support.
