# ADR-0051: Make metadata write-back backups optional per library

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0048 includes reviewed in-file metadata updates. A mandatory verified-backup profile was proposed, but the user explicitly chose optional per-library backups instead.

## Decision

The user selected the following on 2026-11-13:

- Make backups optional per library for reviewed in-file metadata updates.
- Do not turn the proposed mandatory-backup policy into an implementation requirement.

## Alternatives

- Require a verified retained backup for every write.
- Let each library configure whether backups are created, as selected.

## Consequences

Preview and operation state must reflect the configured backup policy. Backup-disabled write-back does not promise an original retained copy or a way to restore old bytes after successful publication. This decision does not authorize scans/provider refreshes to write files or accept the remainder of the earlier mandatory-backup/replacement proposal by implication. ADR-0046 still preserves the external source of a managed copy import. Byte/content-version changes remain governed by ADR-0044/0048.

## Verification

Planned for T004: library backup settings are isolated, backup-enabled writes create the promised backup, backup-disabled writes do not pretend one exists, and the preview reflects the selected policy. No runtime writes were performed in this decision session.

## Open questions

ADR-0057 now selects backups off by default, configured opt-in backup storage with no automatic pruning, and required staged validation/journaling/version checks/safe replacement independent of backup enablement. Concrete journal/backup formats and platform evidence remain specification/implementation work.
