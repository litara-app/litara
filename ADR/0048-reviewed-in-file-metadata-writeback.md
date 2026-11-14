# ADR-0048: Include explicitly reviewed in-file metadata updates

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0014 permits explicit file write-back but leaves its policy unresolved. T004 originally considered database/sidecar-only output; the user explicitly selected in-file tag updates as part of this package.

## Decision

The user selected the following on 2026-11-13:

- Include reviewed in-file tag/metadata updates in T004, rather than deferring them.
- Retain the selected source-priority/protection rules (ADR-0047); database changes or provider refreshes alone are not permission to modify original files.

## Alternatives

- Database only.
- Database plus reviewed sidecar export, deferring original-file updates.
- Include reviewed in-file metadata updates now, as selected.

## Consequences

This is an explicit write-back feature, not automatic tagging during scans/imports or authorization for transcoding. Present a concrete preview of affected files/fields before an authorized write. The accepted byte-based content-version policy means a changed file cannot continue masquerading as unchanged bytes; saved audio anchors must not be transferred silently. Preserve source licenses and embedded chapter/artwork data to the extent supported, with explicit unsupported states when fidelity cannot be demonstrated. No particular writer library, FFmpeg command or format rewrite procedure is selected merely by this decision.

## Verification

Planned for T004 after the write-back safety profile is settled: user-reviewed fields, protected-value handling, exact-format round trips, interrupted writes, byte/content-version accounting and backup restoration where enabled and verified journaled recovery where backups are off. No write-back operation was executed in this decision session.

## Open questions

ADR-0051/0057 now select optional backups, default off, and mandatory staged/recoverable write publication; ADR-0052 gates the initial format targets on fidelity tests; ADR-0053 selects reviewed JSON sidecar export. Concrete per-format writers, fields and recovery phases require implementation evidence. Byte/content-version invalidation remains governed by ADR-0044.
