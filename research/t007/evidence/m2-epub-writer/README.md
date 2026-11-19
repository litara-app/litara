# M2 evidence: EPUB metadata writer (ADR-0048, ADR-0052, ADR-0057)

Scope: the built-in `epub` writer for `title`, `authors`, `series_name` and `series_index`. MP3, FLAC, M4A and M4B were outside this run. See the later [audio writer qualification](../m2-audio-writers/README.md).

## What the writer guarantees

* Edits are surgical byte-level changes to the OPF `<metadata>` block. Every other zip entry is copied raw (compressed bytes, method, CRC, order, archive comment); only the OPF is recompressed.
* `Validate` proves on the staged file, before replacement: same entry names and methods, SHA-256 of every non-OPF entry's raw bytes unchanged, `mimetype` first and stored, OPF identical outside `<metadata>`, unrequested metadata children byte-identical, and the requested values read back with `ebookmeta.Read` with language and identifier unchanged. The engine uses this validation instead of ffprobe for writers that opt out via `MediaInspection() == false`.
* Refusals (all covered by unit tests): unknown fields, narrators, `series_index` without a series, negative index, malformed or oversized OPF (>1 MiB), >10000 entries, duplicate or encrypted entries, rootfile path traversal, non-UTF-8 declared encoding.
* A writer is disabled until an operator runs `ctl writers enable epub --evidence <readable path>` (this file). `ctl writers list|enable|disable` exist; only built-in formats can be enabled.

## Checks run (2026-11-17, Windows 11, Go toolchain from `go.mod`, PostgreSQL 17 in Docker)

* `go test ./internal/writeback` unit tests (Calibre series, EPUB3 collections, no series, escaping, idempotence, malformed inputs, tamper detection) and DB-backed engine tests (disabled until enabled with evidence; full plan, approve, execute; damaged staged file refused with "Validation failed"; unsupported field refused). A mutation check confirmed the validator rejects injected corruption.
* `scripts/backend/check.sh` with `LITARA_REQUIRE_INTEGRATION=1`: CHECK OK, OPENAPI PARITY OK (additive optional `reason` on `WriterCapability`).
* Live run, `python scripts/t007/epub_writeback_live.py`, results in `live-run.json`: real server and PostgreSQL, a 11-entry stress EPUB, the writer shown disabled with its reason, planning refused with `writer_disabled`, enabled through `ctl`, plan, approve, execute over HTTP. Independent of the Go code, Python `zipfile` plus raw header offsets then showed all 10 non-OPF entries byte-identical, the OPF changed with the new values, `mimetype` first and stored, same file id, new content version, no staged leftovers, and `/titles` reporting the new title, both authors and the series.

## Defect found and fixed during this work

After an approved write (or any same-path replacement) the catalog kept the old title, authors and series: editions were never refreshed after creation. `Scanner.replace` now re-reads the file's own tags and updates the edition's `embedded` evidence; the title row follows only while the edition is its sole child and only for fields without an administrator edit (ADR-0047 precedence, ADR-0061 conservative linking). Regression tests `TestReplacedEbookRefreshesEmbeddedMetadata` and `TestReplacedEbookKeepsAdministratorEdits` failed before the fix.

## Not covered

Real-world EPUB corpora (only synthetic fixtures plus the stress book), EPUB 2 files with exotic OPF layouts, signed or DRM EPUBs (refused), a power loss during replacement, NAS or network mounts, and the audio writers.
