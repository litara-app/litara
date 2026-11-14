# T004 assignment — catalog, library ingestion, metadata and NAS recovery

State: **Executed by a single session; see `handoffs/T004.md` for results and gaps.** Originally a draft brief, unassigned. One worker will own this package; do not infer an assignment from this file. Only the coordinator updates `TASKS.md`.

## Start point

Base: `deed67c` (merge of PR #81, T003) on `codex/t004-assignment-checkpoint`, plus the preparation commit that adds ADR-0044–0061, `research/t004/`, `contracts/t004/` and this brief. The worker records the actual tip hash as base in `handoffs/T004.md`. Suggested implementation branch: `codex/t004-catalog-ingestion`.

T003 is merged, so its identities, layout revisions, readiness and chapter-source rules are the stable model T004 extends (`contracts/t003/model.md`, `handoffs/T003.md`). Read T003's Risks, Decisions needed and Smallest integration steps first.

## Required reading

Root `AGENTS.md`, `TASKS.md`, `ADR/README.md`; ADR-0004, 0006, 0007, 0013, 0014, 0018, 0019, 0025, 0028–0030, 0042, 0043 and all of 0044–0061. `research/t004/decisions.md` and `reference-observations.md`; `contracts/t004/`; `handoffs/T001.md`, `handoffs/T003.md`; `apps/server/internal/{inspect,jobs,catalog,seed}`. Archive scanner code is reference only.

## Outcome

An administrator with a library grant configures a library over an OS-mounted directory, runs a scan, and gets titles, recordings, files, content versions and chapter sources in the catalog, using durable River jobs and the T001 inspector. Moves, replacements, disappearing shares and partial copies are handled without losing identity or history. Uncertain grouping, ordering, CUE association and provider matches become review items. A reviewed managed import copies files without touching the source. A reviewed metadata write (sidecar export first, then in-file for fidelity-tested formats) is staged, journaled and recoverable. The seeded T003 flows keep passing.

## Milestones (each a reviewable commit group)

1. **Schema and contract.** Extend `00001_init.sql` per ADR-0030 with the entities in `contracts/t004/model.md`. Add OpenAPI operations under `contracts/t004/` (library admin, scans, review queue, metadata, imports, write-back) using ADR-0038 conventions and ADR-0056 permissions. Do not change T003 operations incompatibly.
2. **Library roots and reconciliation.** Per-library mode, canonical root containment, default symlink exclusion, explicit root identity sentinel (never auto-created), 15-minute scans plus event hints, 30-second stability observation, two-healthy-scan absence rule, unavailable-root handling that retains catalog (ADR-0050/0054/0059).
3. **Fingerprinting and identity.** Cached SHA-256 keyed by size and mtime, daily and manual verification, unique same-library move matching, same-path replacement with a new content version and unresolved old positions (ADR-0044/0058).
4. **Grouping, ordering, association.** Conservative grouping, disc/track/natural ordering with review on conflict, provisional title links, unambiguous JSON/OPF/CUE association, CUE precedence over embedded chapters per ADR-0029/0042, manual merge/split preserving file IDs (ADR-0045/0055/0061).
5. **Metadata.** Protected edits then sidecar then embedded then provider gaps; opt-in Open Library, Google Books, Audnexus with configurable order and review of uncertain matches. Provider tests use recorded fixtures or a local fake; no live calls in CI (ADR-0047/0049/0060).
6. **Managed import.** Verified copy-only import with preview, bulk approval, duplicate skip/keep, visible non-overwrite suffixes; source retained (ADR-0046/0054).
7. **Write-back.** JSON sidecar export, then in-file writers enabled one format at a time only with fidelity evidence (content, chapters, artwork). Staged validation, durable journal, version recheck, safe replacement, optional per-library backups default OFF whose failure blocks the write (ADR-0048/0051–0053/0057). A format without evidence stays disabled and reported as such.
8. **Recovery tests and handoff.**

## Job-queue rule (user decision 2026-11-13: stay on River core)

River core stays (ADR-0024). Keep the exit cheap: T004 code reaches River only through a narrow interface in `internal/jobs` (transactional enqueue, periodic schedule, cancel, status). All business state (scan runs, import and write journals, review items) lives in our tables, never in River's tables; jobs only wake work and must be idempotent. Serialize per-library work with our own unique constraints (for example `scan_runs_one_active`), not River Pro features.

## Exclusive write scope

`apps/server/**` (new catalog/library/scan/import/metadata/writeback packages, migrations, sqlc, tests), `contracts/t004/**`, `scripts/backend/**`, `scripts/contracts/**`, `.github/workflows/backend.yml`, `deploy/**` (dev only), `research/t004/**`, `handoffs/T004.md`. T003 server code may be extended where the model requires it; keep T003 tests green and explain each change in the handoff.

Not in scope: `apps/android/**`, `apps/web/**`, `ADR/**`, `TASKS.md`, root files, `archive/**`, `design/**`. Request changes through the handoff.

## Verification required

- `scripts/backend/check.sh` with `LITARA_REQUIRE_INTEGRATION=1`, real PostgreSQL, real ffprobe/FFmpeg; no silent skips; sqlc and OpenAPI parity current.
- Generated fixtures only (see `contracts/t004/scenarios.json`): move, rename, ambiguous move, same-path replacement, partial copy, mid-scan disappearance, unavailable root, root identity mismatch, symlink outside root, multi-disc ordering conflicts, ambiguous CUE, protected edit vs sidecar vs embedded, provider uncertain match, import duplicate and name collision, write interrupted at each journal stage.
- Restart/retry for scan, import and write jobs; bounded concurrency; originals byte-identical unless a reviewed write ran.
- Per-platform evidence: state exactly which OS and filesystem each check ran on. Windows SMB, Linux NFS/SMB and atomic-replacement claims need their own evidence; untested stays "untested". Simulated disconnects are not NAS acceptance (T007).
- Container smoke with read-only media mount for index mode and a separate writable mount for managed mode.
- Contract exercised by a plain HTTP client; non-admin and no-grant users rejected on every route.

## Boundaries

No transcoding or conversion, automatic write-back, automatic deletion or pruning, direct SMB/NFS clients, additional providers, OPF export, or live provider calls in CI. No secrets, signing, publishing or real mail. Do not silently choose release, binary-source or production migration policy. A genuinely new architectural choice becomes a proposed ADR plus a handoff note while independent work continues.

## Deliverable

One reviewable branch with `handoffs/T004.md` (base/head, governing ADRs, changed paths, exact check results, skipped/untested items, risks, integration steps). Worker reports Ready for review; the coordinator marks Done.
