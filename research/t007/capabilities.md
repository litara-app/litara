# T007 capability matrix (observed, not release acceptance)

Legend: **observed** = exercised in T007 with the evidence named; **inherited** = earlier task evidence not re-run here; **untested**; **unsupported/open** = explicit reason. Fixtures are synthetic unless stated. All client results are from emulators (Pixel_9_Pro API 37, Pixel_Tablet API 36), the Chromium harness or scripts; no physical device was used.

## Ebook and comic formats

| Format | Server catalog/read | Native Android read | Position sync | Annotations | Writer |
| --- | --- | --- | --- | --- | --- |
| EPUB | observed (scan, edition, content Range/HEAD, TLS) | observed (Foliate WebView; page, relaunch, offline) | observed canonical `foliate-cfi` under the web profile (synthetic locator round trip, `m1-locators`) | observed highlights/notes (`m1-annotations`) | **observed** title/authors/series_name/series_index only (`m2-epub-writer`); other fields refused |
| FB2 | recognized; locator proof synthetic | untested on device | canonical by locator proof (synthetic) | by proof, synthetic | none |
| KEPUB | recognized | untested | **open** (not proven equal to web) | open | none |
| MOBI/AZW/AZW3 | recognized | untested | **open** | open | none |
| PDF | observed (extraction not needed; Range) | observed (PdfRenderer page view) | canonical `pdf-page` at page granularity only; sub-page coordinates open | text selection untested; PDF annotation UI absent | none |
| CBZ | observed (page manifest, extraction, kill/restart) | observed (comic host, offline untested) | observed canonical `comic-page` (manifest identity) | observed page bookmark/note | none |
| CBR/CB7 | server support inherited (ADR-0072) | untested | untested | untested | none |

## Audio formats

| Format | Server | Android playback | Writer |
| --- | --- | --- | --- |
| MP3, M4A/M4B, FLAC, Ogg/Opus, WAV, AAC | recognized and inspected with the bundled ffprobe (inherited T001/T002; backend smoke imports and catalogs 9 recordings) | inherited T003 evidence; T007 did not re-run native playback | **none registered**: MP3/FLAC/M4A/M4B stay disabled with a visible reason (`GET /admin/writers`); fidelity evidence does not exist |
| >4 GiB valid media | arithmetic proven only (sparse); valid >4 GiB seek/Range open | open | n/a |

## Per-capability notes

* **Read / resume / annotate / finish:** observed for EPUB, PDF, CBZ in the native Android app; two-device conflicts for finish observed (`m1-finish-conflicts`).
* **Download / offline:** EPUB offline relaunch observed on the emulator (airplane mode); PDF and comic local stores have unit tests, but offline relaunch of PDF/CBZ was not exercised on a device; browser offline downloads are out of scope.
* **Write (in-file):** EPUB only, per field set above, with byte-level fidelity validation, optional backups default off, kill-safe (`m3-writeback-kill`). Sidecar write exists from T004 (inherited).
* **Server/transport:** TLS two-origin, cookies/CSRF, bearer refresh and revocation observed (`m3-tls-origins`, no browser); KOReader progress state durable across hard kill (`m3-koreader-kill`, synthetic client speaking the wire protocol, not the KOReader app); SMTP boundary safe (`m3-smtp-kill`, local sink).
* **Accessibility, real corpora, NAS, KOReader/OPDS apps, Chromecast, Android Auto, physical phone:** untested; see `release-gates.md`.
