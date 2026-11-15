# ADR-0072: CBR and CB7 extraction libraries

Status: Accepted
Date: 2026-11-15
Decision owner: Repository owner

## Context

ADR-0027 and ADR-0067 require CBR/CB7 extraction to stay in Go with vetted dependencies, no extra native executable, bounded library extraction and explicit unsupported states. No library had been approved, so `cbr`/`cb7` editions were reported `incomplete` (`archive_library_not_approved`). CBZ already worked end to end.

Candidates were checked on 2026-11-15 against the Go module proxy, upstream license files and the OSV database:

| Candidate | Version (published) | License | Notes |
| --- | --- | --- | --- |
| `github.com/nwaples/rardecode/v2` (CBR) | v2.4.6 (2026-11-04) | BSD-2-Clause | Pure Go, no dependencies. The v1 module has an unfixed dictionary-size advisory (GO-2025-4020); v2 is fixed from v2.2.0 and offers `MaxDictionarySize` (default 4 GiB). |
| `github.com/bodgit/sevenzip` (CB7) | v1.6.5 (2026-07-10) | BSD-3-Clause | Pure Go, 13 direct modules (one MPL-2.0). Requires Go 1.25 (this module uses 1.26). |
| `github.com/mholt/archives` | v0.1.5 (2025-10-09) | not read | Wraps both plus many unneeded formats, pinning older versions. Not selected. |

## Decision

Accepted by the repository owner's explicit choices on 2026-11-15:

1. CBR and CB7 are adopted **together**, after a dependency audit, using `github.com/nwaples/rardecode/v2` (v2.4.6 or later; never the v1 module) and `github.com/bodgit/sevenzip` (v1.6.5 or later).
2. An MPL-2.0 transitive module (`github.com/hashicorp/golang-lru/v2`) is acceptable for the MIT-licensed backend, with its license text and source-availability note kept in `apps/server/THIRD_PARTY_NOTICES.md`.
3. The RAR dictionary-size ceiling is **128 MiB** (`Limits.MaxDictionary`; operators may only lower it). The same ceiling applies to 7z LZMA/LZMA2.
4. RAR test archives are written by an in-repo minimal RAR5 "store" writer for hostile and edge cases (no proprietary compressor, nothing downloaded); 7z fixtures come from 7-Zip and a minimal in-repo writer.

Everything else is the existing ADR-0067 policy applied through one shared extraction path for ZIP, RAR and 7z: format chosen by content, the same entry, page, size, ratio, pixel and time ceilings, traversal/absolute/link/nested-archive/duplicate-path refusal, encrypted archives refused with an explicit reason, no subprocess and no external executable.

Requirements found by the audit (`research/t005/cbr-cb7-audit.md`) and implemented as part of this decision:
- RAR is read through a filesystem that exposes only the one file, so multi-volume continuations cannot reach neighbouring files.
- 7z headers are validated by a fail-closed pre-check before the library opens the archive, because the library allocates about 130 bytes per file the header claims before checking the claim (a tiny archive could claim billions). Headers that cannot be parsed are refused.
- 7z LZMA and LZMA2 coders are replaced by wrappers that enforce the dictionary ceiling; PPMd, Zstandard, Brotli and LZ4 coders are refused.
- The extraction profile string changes (`comics-go/2`), so earlier cached results, including the old "unsupported" CBR rows, are not reused.
- `cbr`/`cb7` read capability becomes `supported`. This claim is limited to what was tested (see Verification).

## Alternatives

- Keep CBR/CB7 unsupported for the first release. Rejected by the owner.
- External `unrar` or `7z` executables. Forbidden by ADR-0067; the unRAR license also restricts reuse.
- libarchive through cgo. Adds cgo and a native library to every build.
- `mholt/archives`. Pulls in many unneeded modules and older pins of the same two libraries.
- Convert to CBZ inside Litara. Needs its own design and still needs a reader library first.

## Consequences

- CBR comes with one dependency-free module. CB7 adds a larger graph (12 new modules, licenses MIT, BSD, Apache-2.0 and one MPL-2.0).
- Both libraries have had resource-exhaustion defects; the ceilings, the 7z pre-check, the coder allowlist and version pinning are part of the decision, not optional hardening.
- Real RAR files vary (RAR3/RAR5, solid, PPM, multi-volume, self-extracting). Multi-volume and self-extracting archives stay unsupported unless separately decided.
- Library upgrades must re-run the archive tests; the 7z pre-check depends on the library's header layout assumptions.

## Verification

Completed (2026-11-15, in this worktree):
- Dependency audit: licenses read for every linked module, texts copied, OSV clean for the pinned versions (`research/t005/cbr-cb7-audit.md`).
- Go tests: ordinary RAR5 (stored) and 7z (LZMA, solid LZMA2, encoded header) archives in natural page order with entry identities matching ZIP; refusal of traversal, absolute paths, symlinks, encrypted entries/headers, unknown or oversized declared sizes, nested archives, duplicate paths, non-images, entry/page ceilings, dictionary ceilings (RAR, LZMA, LZMA2), disallowed 7z coders, header claims of 2^20 and 2^32 files (plain and encoded); truncation and single-byte corruption never panic; format chosen by content.
- API integration test: CBR and CB7 prepare, extract and serve pages; a damaged RAR ends as `unsupported` with an issue.
- Browser (Chromium, Firefox, WebKit): CBR and CB7 open and page in natural order; a damaged CBR is explained.

Not completed: real compressed RAR files (RAR3/RAR5, solid, PPM) were not tested, no sample files were obtained; large-archive memory and time were not measured; fuzzing was limited. These are listed in the audit.

## Open questions

None within this record's scope. Providing a few real CBR files would extend the verification above.
