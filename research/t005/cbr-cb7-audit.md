# CBR and CB7 dependency audit (ADR-0072)

Date: 2026-11-15. Scope: the Go modules linked into the server for RAR and 7z page extraction. Everything below was run in this worktree; "not tested" lists are part of the result.

## Modules, licenses and advisories

`go list -deps ./internal/comics` shows 13 external modules; 12 are new with this work (`golang.org/x/text` was already used). License text was read from each module's LICENSE file in the module cache and copied to `apps/server/third_party/licenses/`. Advisories come from an OSV batch query for the exact pinned versions.

| Module | Version | License | OSV advisories |
| --- | --- | --- | --- |
| `github.com/nwaples/rardecode/v2` | v2.4.6 | BSD-2-Clause | none |
| `github.com/bodgit/sevenzip` | v1.6.5 | BSD-3-Clause | none |
| `github.com/bodgit/plumbing` | v1.3.0 | BSD-3-Clause | none |
| `github.com/bodgit/windows` | v1.0.1 | BSD-3-Clause | none |
| `github.com/hashicorp/golang-lru/v2` | v2.0.7 | MPL-2.0 (accepted by the owner, 2026-11-15) | none |
| `github.com/klauspost/compress` | v1.20.4 | Apache-2.0 (file also carries BSD-3-Clause parts) | none |
| `github.com/andybalholm/brotli` | v1.3.0 | MIT | none |
| `github.com/pierrec/lz4/v4` | v4.1.33 | BSD-3-Clause | none |
| `github.com/spf13/afero` | v1.15.0 | Apache-2.0 | none |
| `github.com/stangelandcl/ppmd` | v0.1.1 | MIT | none |
| `github.com/ulikunitz/xz` | v0.5.15 | BSD-3-Clause | none |
| `go4.org` | v0.0.0-20260112195520 | Apache-2.0 | none |

The v1 module `github.com/nwaples/rardecode` has an unfixed advisory (GO-2025-4020 / GHSA-rwvp-r38j-9rgg, unrestricted dictionary size). It is not used; v2 is fixed from v2.2.0.

## Findings and what was done

| Finding | Evidence | Mitigation (all in `apps/server/internal/comics`) |
| --- | --- | --- |
| rardecode's default dictionary ceiling is 4 GiB. | `rardecode.DefaultMaxDictionarySize`. | `MaxDictionarySize(128 MiB)` (`Limits.MaxDictionary`, operators may only lower it). The library also limits the dictionary to the entry's declared size, so with the per-entry ceiling (100 MiB) a tiny archive cannot demand more than the entry cap. Test: a lowered ceiling refuses a method-3 entry. |
| rardecode follows multi-volume continuations to neighbouring files. | `FileSystem` option and `Volumes()`. | The reader is given a filesystem that exposes only the one archive file; a continuation fails cleanly. Test: a truncated archive is refused. |
| **sevenzip allocates one `FileHeader` per file the header claims, before validating the claim.** | Measured: a claim of 1 M files allocated 129 MiB, 4 M allocated 518 MiB, 16 M allocated 2075 MiB (linear, about 130 bytes each), from a header of roughly 100 bytes. The count can be up to 2^32, so a tiny archive could exhaust server memory. | `precheckSevenZip` reads the signature header and the plain or LZMA/LZMA2-encoded header with bounded memory (16 MiB), walks to the file count, and refuses anything above the entry ceiling or anything it cannot parse (fail closed) before the library opens the archive. Tests: plain and encoded headers claiming 2^20 and 2^32 files are refused; real 7-Zip archives and writer-made encoded headers still open; every prefix and every single-byte flip of a real archive returns without panic. |
| sevenzip does not bound the LZMA/LZMA2 dictionary named in the header. | Source: `internal/lzma2/reader.go` passes the header's dictionary to the decoder. | The LZMA and LZMA2 coders are replaced by wrappers that check the dictionary against `MaxDictionary` before decoding. Tests: 1 GiB claims are refused. |
| Coders whose memory cannot be bounded here. | PPMd, Zstandard, Brotli and LZ4 are non-standard or memory-parameterized. | Registered as refusals. Tests: each is refused with a typed reason. |
| Encrypted archives. | RAR `Encrypted`/`HeaderEncrypted`; 7z AES. | Refused with an explicit reason. Tests: RAR entry flag, 7z content-encrypted and header-encrypted archives made with 7-Zip. |
| Entry names, links, nested archives, duplicate normalized paths, declared sizes, entry/page counts, expansion ratio, time. | Existing ADR-0067 rules. | The same checks now run for ZIP, RAR and 7z through one shared path. Tests per format (traversal, absolute path, symlink, unknown size, oversized declared size, nested archive, duplicate path, no pages, not an image, entry and page ceilings). |
| The format is chosen by file content, never the extension. | Many "CBR" files are really ZIP. | Magic numbers decide. Tests: a ZIP named `.cbr` and a RAR named `.cbz` both read. |

## Not tested or not covered

- **Real compressed RAR files: one tested.** The owner supplied a real 16 MB RAR4 comic (69 entries, 68 compressed, not solid); it extracted to 68 JPEG pages (1200x1558) in 0.48 s with about 4 MiB allocated, using `TestRealArchiveFromEnvironment` (skipped unless `LITARA_TEST_REAL_ARCHIVE` is set; the file is not in the repository). RAR5, solid, PPM and RAR3-with-VM-filter archives were not tested with real files; RAR5 is covered only by generated "store" archives from `internal/comics/archivetest`.
- 7z coders other than copy, LZMA and LZMA2 (deflate, bzip2, delta, BCJ filters) are left at the library defaults; they use small fixed memory, but were not tested with hostile input here.
- Fuzzing was limited to truncation and single-byte corruption of one real 7z.
- Large-archive performance and memory use were not measured; the 120-second ceiling is enforced between entries and on every write, but not inside a single library skip of up to 100 MiB.
- Multi-volume and self-extracting archives are refused, not supported.
