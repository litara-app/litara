# ADR-0072: CBR and CB7 extraction libraries

Status: Proposed
Date: 2026-11-15
Decision owner: Repository owner

## Context

ADR-0027 and ADR-0067 require CBR/CB7 extraction to stay in Go with vetted dependencies, no extra native executable, bounded library extraction and explicit unsupported states. No library has been approved, so the server reports `cbr`/`cb7` editions as `incomplete` (`archive_library_not_approved`) and the web reader shows an explicit "cannot be opened" state. CBZ works end to end (extraction, page manifest, cache budget, natural page order, hostile-entry refusal).

Candidates were checked on 2026-11-15 against the Go module proxy, upstream license files and the OSV database. Version and date facts are from the proxy; behavior statements come from the libraries' own documentation or `go doc` and have **not** yet been exercised against Litara fixtures.

| Candidate | Version (published) | License | Dependencies | Notes |
| --- | --- | --- | --- | --- |
| `github.com/nwaples/rardecode/v2` (CBR) | v2.4.6 (2026-11-04) | BSD-2-Clause (upstream LICENSE read) | none (its `go.mod` has no `require`) | Pure Go streaming reader. The v1 module is affected by GO-2025-4020 / GHSA-rwvp-r38j-9rgg (unrestricted dictionary size, DoS) with no fix; v2 is fixed from v2.2.0 and offers `MaxDictionarySize(size)` (default constant is 4 GiB, so a lower limit must be set). `FileHeader` exposes `Encrypted`, `HeaderEncrypted`, `UnPackedSize`, `UnKnownSize`, `Solid`, `LinkType`; `Password(...)`/`ErrBadPassword` exist, so encrypted archives can be refused. |
| `github.com/bodgit/sevenzip` (CB7) | v1.6.5 (2026-07-10) | BSD-3-Clause (upstream LICENSE read) | 13 direct modules (brotli, plumbing, windows, golang-lru/v2, klauspost/compress, lz4, afero, ppmd, xz, go4.org, x/sync, x/text, testify) | Pure Go reader; requires Go 1.25 (this module is on Go 1.26). No OSV advisories found. Licenses read directly: sevenzip, bodgit/plumbing, bodgit/windows (BSD-3-Clause) and stangelandcl/ppmd (MIT). **Not yet verified:** the licenses of the other direct and transitive modules. From general knowledge `hashicorp/golang-lru/v2` is MPL-2.0 (file-level copyleft), which needs a separate decision. |
| `github.com/mholt/archives` | v0.1.5 (2025-10-09) | not read | wraps the two libraries above plus many other format and compression modules | Pins older versions (rardecode v2.2.0, sevenzip v1.6.1) and adds formats Litara does not need. Not recommended. |

## Decision

Proposed (not approved):

1. Approve `github.com/nwaples/rardecode/v2` at v2.4.6 or later for CBR. Never use the v1 module. Treat it as the first step: it has no dependencies and a BSD-2-Clause license.
2. Treat CB7 as a second step. Approve `github.com/bodgit/sevenzip` only after a license audit of its full module graph (including the MPL-2.0 question above) and its own resource-limit tests. Until then CB7 stays unsupported with the existing explicit state.
3. Both would be used only through the existing bounded extraction path (ADR-0067): entry-count, per-entry and total expanded size limits, expansion ratio, path-traversal and absolute-path refusal, links refused, encrypted or header-encrypted archives refused with an explicit reason, a conservative `MaxDictionarySize`, a time limit, and the same cache budget. Solid archives are decompressed sequentially under the same limits. No subprocess and no external executable.
4. Capabilities stay conservative (ADR-0025): `cbr`/`cb7` read becomes `supported` only after fixtures for that format pass in the web reader; unhandled RAR/7z variants return an explicit unsupported or failed state, not a guess.

## Alternatives

- **Keep CBR/CB7 unsupported for the first release.** No dependency or review cost. Users convert to CBZ outside Litara. This stays the fallback if the owner prefers not to add the dependencies yet.
- **External `unrar` or `7z` executables.** Forbidden by ADR-0067 (no extra native executable); the unRAR license also restricts reuse.
- **libarchive through cgo.** Broad format support, but adds cgo and a native library to every build and conflicts with the pure-Go decision.
- **`mholt/archives`.** One dependency for both, but it pulls in many unneeded modules and currently pins older versions of the same two libraries.
- **Convert to CBZ inside Litara.** Needs an explicit conversion design (automatic conversion is not selected under ADR-0028) and still needs a reader library first.

## Consequences

- CBR comes with one small, dependency-free module. CB7 adds a larger dependency graph and a possible MPL-2.0 module that must be accepted or avoided.
- The v1 `rardecode` advisory shows these libraries have had resource-exhaustion defects; limits, fixtures and version pinning are part of the decision, not optional hardening.
- Real-world RAR files vary (RAR3/RAR5, solid, multi-volume, SFX). Multi-volume and SFX would stay unsupported unless separately decided.
- Authoring RAR test fixtures needs a RAR compressor, which is proprietary. Fixtures would have to come from a locally available `rar` (output files are Litara's own) or from upstream test data used under its license with notices.

## Verification

Planned, none completed:
- Dependency audit: `go.mod` pins, license of every module in `go mod graph`, `govulncheck` (or OSV) clean, third-party notices updated.
- Fixtures per format: ordinary archive, solid, encrypted, header-encrypted, oversized dictionary, huge declared size, many entries, traversal and absolute paths, link entries, truncated and corrupt archives.
- Resource-limit tests prove memory and time stay bounded for each hostile fixture.
- Web end-to-end in Chromium, Firefox and WebKit: extraction, natural page order, page note/bookmark, resume, and explicit failure for the hostile fixtures.

## Open questions

Owner input recorded 2026-11-15 (the ADR stays Proposed until the remaining questions are answered):
- Answered: CBR and CB7 are to be adopted together, after the dependency license audit (not CBR alone first).
- Answered: an MPL-2.0 transitive module (expected `hashicorp/golang-lru/v2`) is acceptable for the MIT-licensed backend; its notice and source-availability terms still have to be satisfied and recorded in the audit.

Still open:
- Which archive-specific limits to add on top of the ADR-0067 ceilings (the RAR dictionary-size cap and the 7z equivalent)?
- Who provides RAR test fixtures: a local RAR compressor, upstream test data under its license, or a minimal in-repo writer that emits only the structures the tests need?
