# ADR-0007: Support NAS book folders with local application state

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

BookOrbit's current README excludes writable network-storage configurations. Self-hosted book collections may live on NAS shares where notifications and availability differ from local disks.

## Decision

The user selected official support for NAS/network-share book folders. Keep database and application state on local storage. Support claims must be tied to tested storage configurations rather than an assumption that network mounts behave identically to local disks.

## Alternatives

- Local book disks only.
- NAS book folders with local state, as selected.
- NAS for all state, including database files.

## Consequences

File notifications cannot be the only reconciliation mechanism. A missing mount must not be interpreted as deletion of the whole collection. Managed imports need recovery behavior across filesystem boundaries. This choice does not yet promise every network filesystem or direct SMB/NFS protocol clients.

## Verification

Planned: test share disconnect/reconnect during scanning and importing, missing notifications, incomplete copies, and stale listings. Confirm catalog/history remain intact when a root is unavailable. Publish a tested configuration matrix before release.

## Open questions

Initial SMB/NFS support matrix, mount-health detection, scan schedule, read/write guarantees, and cross-volume import recovery remain to be specified.
