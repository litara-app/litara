# T004 accepted decision summary

Decision pass completed 2026-11-13. All choices below were explicitly selected by the user; no elapsed-time or recommended-option acceptance was inferred. The ADRs are authoritative. This summary does not assign implementation or change T003’s active write scope.

| ADR | Accepted decision |
| --- | --- |
| [0044](../../ADR/0044-fingerprint-moves-and-content-replacements.md) | Match unique file moves and version changed bytes |
| [0045](../../ADR/0045-conservative-grouping-and-manual-repair.md) | Group conservatively and preserve identities through manual repair |
| [0046](../../ADR/0046-reviewed-copy-only-managed-imports.md) | Copy verified managed imports after explicit review |
| [0047](../../ADR/0047-metadata-source-priority-and-protected-clears.md) | Prefer protected edits then sidecar metadata over embedded values |
| [0048](../../ADR/0048-reviewed-in-file-metadata-writeback.md) | Include explicitly reviewed in-file metadata updates |
| [0049](../../ADR/0049-opt-in-metadata-providers.md) | Include opt-in Open Library Google Books and Audnexus enrichment |
| [0050](../../ADR/0050-mounted-nas-reconciliation-and-stability.md) | Reconcile OS-mounted libraries without destructive absence handling |
| [0051](../../ADR/0051-optional-backups-per-library.md) | Make metadata write-back backups optional per library |
| [0052](../../ADR/0052-fidelity-tested-tag-writing-formats.md) | Enable metadata writes only for fidelity-tested formats |
| [0053](../../ADR/0053-reviewed-json-sidecar-export.md) | Offer previewed JSON sidecar export alongside in-file updates |
| [0054](../../ADR/0054-per-library-modes-and-managed-naming.md) | Configure library modes and preview managed-import templates |
| [0055](../../ADR/0055-unambiguous-sidecar-and-cue-association.md) | Associate sidecars and CUE only without ambiguity |
| [0056](../../ADR/0056-shared-catalog-administrator-library-permissions.md) | Require administrator status and a library grant for catalog management |
| [0057](../../ADR/0057-writeback-recovery-with-backups-off-by-default.md) | Default backups off while requiring recoverable staged writes |
| [0058](../../ADR/0058-sha256-cache-and-content-verification.md) | Cache SHA-256 fingerprints with daily and manual verification |
| [0059](../../ADR/0059-canonical-root-boundaries-and-explicit-health.md) | Contain paths and explicitly verify library root identity |
| [0060](../../ADR/0060-provider-priority-and-identifier-match-review.md) | Configure provider priority and review uncertain metadata matches |
| [0061](../../ADR/0061-audio-ordering-and-provisional-title-links.md) | Order audio from consistent evidence and review uncertain title links |

## Important write-back boundary

Backups are optional per library and **default OFF**. If enabled, their failure blocks the write, they use configured backup storage, and no automatic pruning is selected yet. Staged validation, durable recovery journals, version rechecks and safe per-file replacement remain required with backups either on or off. An operation without a retained backup does not promise restoration of the old original after successful publication; recovery can complete the verified journaled replacement. Scans/provider refreshes never implicitly authorize a write. In-file/sidecar replacements require concrete review, and changed bytes get a new content version without silently transferring saved positions.

EPUB, MP3, FLAC and M4A/M4B are initial writer targets, not a claim of tested writing support. Enable each only after fidelity evidence for content, chapters and artwork; no transcoding/conversion. Optional reviewed JSON sidecar export does not authorize OPF export or background sidecar overwrites.

## Assignment prerequisites

The policy decision pass is complete. Next author the concrete T004 ingestion/write-back contract, schema/interface boundary, source/association examples, review/job/recovery fixtures, per-platform checks and exclusive execution brief. T003 currently owns server/schema/contracts; T004 must use its stable integrated handoff or explicitly narrowed, coordinated scopes before implementation. Commit the eventual worker checkpoint. T004 remains unassigned, and no scanner/importer/provider/write-back/NAS runtime behavior was executed in this decision session.

[Reference observations](reference-observations.md) distinguish archived code/current provider documentation from the selected policies. Future destructive moves, automatic cleanup/pruning, additional providers and unverified writer/platform support remain outside the accepted slice.
