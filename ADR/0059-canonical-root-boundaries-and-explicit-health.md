# ADR-0059: Contain paths and explicitly verify library root identity

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0050 requires a root identity/health check before absence reconciliation. Library templates, symlinks, CUE FILE entries and OS-mounted shares need a common safe path boundary without silently writing to index-only source folders.

## Decision

The user selected the following on 2026-11-13:

- Keep scan/import/CUE paths inside the configured canonical library root.
- Ignore symlinks by default.
- Validate configured root identity before absence reconciliation using an operator-supplied sentinel or equivalent check.
- Never automatically create marker files in an existing library.

## Alternatives

- Allow links whose canonical targets remain inside the root by default.
- Treat directory existence as sufficient root health.
- Canonical root containment, default link exclusion and explicit identity check, as selected.

## Consequences

Reject traversal/escaping FILE/template references and do not follow a renamed/replaced link outside the boundary. Relative paths that remain within the recording/library boundary still require unambiguous association. Existing-folder scanning is read-only. Root health configuration must distinguish the intended mounted dataset from an empty local mountpoint; failure prevents missing-file confirmation. A configured backup store is separate from scanned source roots and requires its own explicit writable destination; do not accidentally scan backups/staging as duplicate books. Platform reparse points and boundary changes during an operation require equivalent scrutiny to ordinary symlinks.

## Verification

Planned for T004: symlink/reparse escapes, relative traversal, symlink inserted during a job, wrong/missing root marker, mountpoint present but share unavailable, no automatic marker creation, and managed destinations staying inside their canonical root. Name actual platform/NAS checks separately from simulations. No filesystem manipulation occurred in this decision session.

## Open questions

None within this record’s policy scope. Concrete interfaces/fixtures must be specified in the T004 execution brief.
