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
| CBR/CB7 | server support inherited (ADR-0072) | untested | untested | **pass** (same) | none |

## Audio formats (server catalog, original delivery and browser playback; observed 2026-11-18 on synthetic fixtures)

After the user's decision to widen the allowlist (finding F5, `catalog.SupportedMIME`), every type the scanner catalogs is `ready` when inspected cleanly. Server results: `evidence/m4-corpus/audio-corpus.json` (`python scripts/t007/audio_corpus.py`); browser results: `evidence/m4-corpus/audio-playback-{chromium,firefox,webkit}.json` (`node scripts/t007/audio_browser.mjs BROWSER`: original fetched with the bearer token, played, advanced, seeked near the end).

| Format | Server (ready, play/download, HEAD, head and tail Range with exact bytes) | Chromium (Playwright) | Firefox (Playwright) | WebKit (Playwright, Windows) | Android | Writer |
| --- | --- | --- | --- | --- | --- | --- |
| MP3 (and 3-part recording) | pass | play+seek pass | pass | fails for every format (no media decoders in this build; environment limit, not format specific) | **pass** (real app, API 37 emulator: plays, position advances, scrubber seek) | none |
| M4A, M4B with 3 embedded chapters | pass; chapters `embedded` at 0/10/20 s | pass | pass | fail (as above) | **pass** (same) | none |
| FLAC | pass | pass | pass | fail (as above) | **pass** (same) | none |
| Ogg Vorbis | pass | pass | pass | fail (as above) | **pass** (same) | none |
| Opus (`audio/opus`) | pass | pass | pass | fail (as above) | **pass** (same) | none |
| WAV | pass | pass | pass | fail (as above) | **pass** (same) | none |
| Raw AAC (ADTS) | pass (duration estimated by ffprobe, 19629 ms vs 20000) | pass | pass | fail (as above) | **pass** (same) | none |
| Valid >4 GiB media | arithmetic proven earlier with sparse files only | open | open | open | open | n/a |

Defect found while checking: `canPlayType("audio/opus")` is empty in Chromium and Firefox although Ogg Opus plays, so the web player would have refused `.opus` files. `apps/web/src/audio/mime.ts` (`probeType`) now probes `audio/ogg; codecs="opus"` (and maps the x-m4a/x-m4b aliases), with unit tests. Android playback of every format was then verified in the real app on the Pixel_9_Pro emulator (API 37) with `scripts/t007/android_audio.sh` (`evidence/m4-corpus/android-audio-playback.txt`, 8/8 play and scrubber-seek; fixtures are 20-30 s so only short seeks were exercised). Getting there exposed a sign-in defect (F7 below). MP3/FLAC/M4A/M4B in-file writers remain absent.

## Per-capability notes

* **Read / resume / annotate / finish:** observed for EPUB, PDF, CBZ in the native Android app; two-device conflicts for finish observed (`m1-finish-conflicts`).
* **Download / offline:** EPUB offline relaunch observed on the emulator (airplane mode); PDF and comic local stores have unit tests, but offline relaunch of PDF/CBZ was not exercised on a device; browser offline downloads are out of scope.
* **Write (in-file):** EPUB only, per field set above, with byte-level fidelity validation, optional backups default off, kill-safe (`m3-writeback-kill`). Sidecar write exists from T004 (inherited).
* **Server/transport:** TLS two-origin, cookies/CSRF, bearer refresh and revocation observed (`m3-tls-origins`, no browser); KOReader progress state durable across hard kill (`m3-koreader-kill`, synthetic client speaking the wire protocol, not the KOReader app); SMTP boundary safe (`m3-smtp-kill`, local sink).
* **Accessibility, real corpora, NAS, KOReader/OPDS apps, Chromecast, Android Auto, physical phone:** untested; see `release-gates.md`.
