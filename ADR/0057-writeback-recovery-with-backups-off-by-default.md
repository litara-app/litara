# ADR-0057: Default backups off while requiring recoverable staged writes

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0051 selects optional per-library backups, but does not accept the original mandatory-backup proposal. The user subsequently selected the default, storage/retention boundary and replacement rules independently of backup creation.

## Decision

The user selected the following on 2026-11-13:

- Backups default off and can be enabled per library.
- When enabled, use configured backup storage, do not automatically prune backups yet, and block the write if the promised backup fails.
- With backups either on or off, require staged validation, a durable recovery journal, version rechecks and safe per-file replacement.
- Refuse writes on filesystems where these guarantees cannot be established.

## Alternatives

- Backups on by default or mandatory for all writes.
- Optional unsafe in-place writes without staging/recovery checks.
- Backups off by default with the same required write-recovery rules, as selected.

## Consequences

Backup-disabled writes do not retain a post-success original or promise rollback to old bytes. Recoverable publication can mean completing the journaled, verified new version rather than restoring an unavailable original. Enabling backups is distinct from temporary staging needed for validation. Never expose partial output or serve changed bytes under an old content version. A changed source/permission/destination since preview invalidates that plan; do not overwrite unrelated concurrent edits. Update byte/content/layout versions and preserve incompatible resume candidates under ADR-0044/0048 instead of silently transferring positions. Platform/NAS atomic replacement must be proven, not inferred from local filesystem behavior.

## Verification

Planned for T004: off-by-default/on/off per-library settings, configured-backup failure blocking an enabled write, validated staged output, mid-write crash/restart, changed source after approval, conflict with a scan/second writer, safe roll-forward when no backup exists and original restoration when a verified backup is enabled. Confirm no bytes are served under an incorrect content version. No writes were performed in this decision session.

## Open questions

Backup filename/schema, durable journal phases and per-platform replacement capabilities must be specified and verified in the T004 brief/implementation. Automatic pruning and destructive cleanup remain unselected.
