# T007 capability matrix (observed, not release acceptance)

Legend: **observed** = exercised in T007 with the evidence named; **inherited** = earlier task evidence not re-run here; **untested**; **unsupported/open** = explicit reason. Fixtures are synthetic unless stated. All client results are from emulators (Pixel_9_Pro API 37, Pixel_Tablet API 36), the Chromium harness or scripts; no physical device was used.

## Ebook and comic formats

| Format | Server catalog/read | Native Android read | Position sync | Annotations | Writer |
| --- | --- | --- | --- | --- | --- |
| EPUB | observed (scan, edition, content Range/HEAD, TLS) | observed (Foliate WebView; page, relaunch, offline) | observed canonical `foliate-cfi` under the web profile (synthetic locator round trip, `m1-locators`) | observed highlights/notes (`m1-annotations`) | **observed** title/authors/series_name/series_index only (`m2-epub-writer`); other fields refused |
| FB2 | observed: Calibre-converted FB2 is `ready` (text selection/highlight `incomplete`); locator proof synthetic | untested on device | canonical by locator proof (synthetic) | by proof, synthetic | none |
| KEPUB | observed: `incomplete` (`format_untested`), original downloadable | untested | **open** (not proven equal to web) | open | none |
| MOBI / AZW3 | observed: Calibre-converted files are `ready` for read/resume (text selection/highlight `incomplete`) | untested | **open** | open | none |
| EPUB fixed layout | observed: cataloged `ready` (server capability is format-level; renderer behavior not tested) | untested | untested | untested | untested (writer refuses nothing specific) |
| Damaged EPUB (truncated zip) | **finding F6:** cataloged `ready`/`supported` although the container is unreadable; no damaged state exists | untested | n/a | n/a | n/a |
| PDF | observed (extraction not needed; Range) | observed (PdfRenderer page view) | canonical `pdf-page` at page granularity only; sub-page coordinates open | text selection untested; PDF annotation UI absent | none |
| CBZ | observed (page manifest, extraction, kill/restart) | observed (comic host, offline untested) | observed canonical `comic-page` (manifest identity) | observed page bookmark/note | none |
| CBR/CB7 | server support inherited (ADR-0072) | untested | untested | untested | none |

## Audio formats (server catalog and original delivery; observed 2026-11-18 on 20 s synthetic ffmpeg fixtures, `evidence/m4-corpus/audio-corpus.json`)

| Format | Inspected (ffprobe) | Server readiness / play / original Range | Chapters | Writer |
| --- | --- | --- | --- | --- |
| MP3 | yes (duration 20000 ms) | **ready**, play and download true, Range 206 | generated per file | none (disabled, visible reason) |
| M4A (AAC) | yes | **ready**, Range 206 | generated | none |
| M4B with 3 embedded chapters | yes (30000 ms) | **ready**, whole-recording seek true | 3 `embedded` chapters at 0/10/20 s | none |
| Multi-file MP3 (3 parts) | yes | **ready**, one recording of 24000 ms from 3 files | generated file-boundary markers | none |
| FLAC, Ogg Vorbis, Opus, WAV, raw AAC (ADTS) | yes (durations correct) | **incomplete**: `file_unsupported` (play/download false, original Range returns 409 `recording_incomplete`) | generated | none |
| Valid >4 GiB media | arithmetic proven earlier with sparse files only | open | open | n/a |

Root cause of the incomplete states: an allowlist, `catalog.SupportedMIME` (`audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/x-m4b`), described in code as the set "this slice can play and download". It is server policy, not a codec limit: the files are cataloged, inspected and kept. ADR-0025 targets the broader range, so widening it (and testing each client) is an open product decision (finding F5). Android and browser playback of the formats that are `ready` was not re-run in T007.

## Per-capability notes

* **Read / resume / annotate / finish:** observed for EPUB, PDF, CBZ in the native Android app; two-device conflicts for finish observed (`m1-finish-conflicts`).
* **Download / offline:** EPUB offline relaunch observed on the emulator (airplane mode); PDF and comic local stores have unit tests, but offline relaunch of PDF/CBZ was not exercised on a device; browser offline downloads are out of scope.
* **Write (in-file):** EPUB only, per field set above, with byte-level fidelity validation, optional backups default off, kill-safe (`m3-writeback-kill`). Sidecar write exists from T004 (inherited).
* **Server/transport:** TLS two-origin, cookies/CSRF, bearer refresh and revocation observed (`m3-tls-origins`, no browser); KOReader progress state durable across hard kill (`m3-koreader-kill`, synthetic client speaking the wire protocol, not the KOReader app); SMTP boundary safe (`m3-smtp-kill`, local sink).
* **Accessibility, real corpora, NAS, KOReader/OPDS apps, Chromecast, Android Auto, physical phone:** untested; see `release-gates.md`.
