# T005 scenario coverage (final review)

Evidence is limited to checks that were actually executed in this worktree. "Covered" means the scenario's expectation was exercised by a test with the real API and, where the scenario requires it, a real browser. "Partial" lists exactly what was and was not exercised. Nothing here is a hardware, NAS or production claim.

**38 scenarios: 20 covered, 18 partial, 0 not covered.**

| Scenario | Verification required | Status | Evidence and gaps |
| --- | --- | --- | --- |
| `scan-editions` | real-api-browser | Partial | API `TestEbookEditionsEndToEnd` (EPUB, conservative link, provisional review). PDF/FB2/comics/translation EPUB were not scanned together; no browser step. |
| `edition-move` | real-api | Covered | API `TestEditionSurvivesFileMoveAndRename`: position, bookmark and annotations survive a rename/move and rescans; same edition/file/version/title IDs; bytes still served; next position write succeeds at the stored revision. |
| `edition-replacement` | real-api-browser | Partial | API `TestEditionContentChangeInvalidatesLocationsAndCompletionHistory` (same edition/file, new version, 412 + durable candidate, refused transfer). No browser step. |
| `ebook-file-auth` | real-api-browser | Covered | API `TestEbookEditionsEndToEnd` (ebook-only library, GET/HEAD/Range exact bytes, other callers denied, no recording row); every reader e2e fetches the bytes through the browser. |
| `cfi-reflow` | real-browser | Partial | Real Foliate-generated CFIs saved and resumed in Chromium, Firefox, WebKit (`reader.spec`). Reflow under a different viewport/profile and unsupported-profile disabling were not tested. |
| `pdf-coordinates` | real-browser | Covered | Browser `pdf.spec.ts` in Chromium, Firefox and WebKit: a cropped (CropBox) and rotated (90) PDF with a known rectangle; the area-highlight drag is saved as unrotated crop-box fractions within 0.02 of the known values; the overlay stays within 3 px of the content at 100% and 70% zoom; reload restores it. PDF positions carry x/y. Android interoperability and text-selection highlights on PDF are not tested. |
| `comic-order` | real-api-browser | Covered | Engine unit test and API `TestComicPagesExtractionServingAndFailures`; browser `comic.spec` verifies 1,2,10 order by decoded page color in all three browsers. |
| `backward-save` | real-api-browser | Covered | API `TestEditionPositionRevisionsReceiptsAndConflicts` (explicit backward seek is a new revision; no percentage/clock choice). |
| `position-conflict` | real-api-browser | Covered | API conflict/resolve tests for editions and recordings; browser `reader.spec` stale write -> banner -> keep-my-place; `offline.spec` conflict resolution page. |
| `operation-replay` | real-api | Covered | API tests: position, completion, annotation, shelf delete, membership replays return identical bodies; changed request is 409 `operation_id_reused`. |
| `manual-ebook-finish` | real-api-browser | Partial | API test (finish/unfinish revisioned, history additive, location untouched). Browser: unit test with mocked fetch only; the reader has no finish button. |
| `annotation-private` | real-api-browser | Covered | API `TestAnnotationLifecyclePrivacyAndSupersession` (administrator with a grant gets 404/empty; ungranted 403); owner-only conflicts and history tested. |
| `annotation-delete-race` | real-api-browser | Covered | API: tombstone retained, stale edit gives durable `deleted` conflict, `use_candidate` cannot resurrect, duplicate delete replays. |
| `annotation-format-matrix` | real-browser | Partial | EPUB highlights persisted (3 browsers); comic page note/bookmark persisted and highlight refused with 422/explicit UI text. PDF highlights absent; text-selection capability is declared `incomplete`. |
| `shared-shelf-permissions` | real-api-browser | Partial | API `TestShelvesPermissionsMembershipOrderAndSmartFilters` is thorough. The shelf screens were driven by hand in the in-app browser only; no automated browser test. |
| `smart-viewer-state` | real-api-browser | Partial | API per-viewer evaluation and personal-state predicates tested; no browser test. |
| `smart-invalid-tree` | real-api | Covered | API 422 cases and unit `TestValidateFilterBounds`; values are bound parameters, fields come from a fixed set. |
| `shelf-concurrency` | real-api-browser | Partial | Concurrent adds at one revision: one winner (API). Concurrent order/remove races were not tested. |
| `shelf-delete-retry` | real-api-browser | Covered | API: owner tombstone, non-owner 404, stale write -> durable `deleted` conflict, delete replay. |
| `reader-scripting` | real-browser | Covered | `reader-isolation.spec`: hostile EPUB (inline/external/blob scripts, SVG events, links), production headers, three browsers. |
| `reader-bridge-forgery` | real-browser | Partial | `reader-isolation.spec`: forged and wrong-origin messages rejected, out-of-range reads refused. "Logout closes the reader and channel" is true by unmount but not tested. |
| `reader-assets-csp` | real-browser | Covered | Foliate, zip.js and PDF.js run under the real CSP on a separate reader origin in three browsers. PDF.js cmaps/fonts/wasm are not vendored (limits some PDFs). |
| `archive-traversal` | real-api | Covered | Engine unit tests (13 hostile shapes) and API test: unsupported manifest, no page published, original byte-identical. |
| `archive-resource-limits` | real-api | Covered | Engine and API tests for entries, pages, sizes, expansion ratio, pixels, time, streaming counter and reserve veto; staging never published. |
| `archive-restart-cache` | real-api | Partial | Cache budget, LRU eviction and active-entry protection tested. Interrupted-extraction restart/recovery was not tested. |
| `grant-revocation` | real-api-browser | Partial | API: revoked grant -> 403 on comic pages and recordings. 403 -> blocked queue record is unit-tested. No browser test of the protected view clearing. |
| `offline-retry-account` | real-browser | Covered | `offline.spec` (3 browsers) and 13 queue unit tests: durable across reload, same operation replayed once, locked at sign-out, never sent as another account, restored for the owner. |
| `web-cookie-csrf` | real-api-browser | Partial | API `TestBrowserSessionCookieOriginAndCSRF`; every browser write uses the cookie + CSRF. HttpOnly was not asserted from the browser. |
| `audio-web-flow` | real-api-browser | Partial | `listen.spec` (3 browsers): real MP3 playback, file/offset anchors, resume without autoplay, queued saving. WebKit reports MP3 unsupported (explicit). Natural-end completion not driven; AAC/M4A not exercised. |
| `repair-merge` | real-api-browser | Covered | API test plus admin browser merge (reorder, plan, approve, apply). Candidates verified via API, not in the admin UI. |
| `repair-split` | real-api-browser | Partial | API split with two competing plans verified; the split UI was not browser-tested. |
| `repair-stale-plan` | real-api | Covered | API: stale layout 412, second plan loses with 412 and `stale`, execute replay returns identical successor IDs. Atomicity was not fault-injected. |
| `repair-tombstone` | real-api | Covered | API: old snapshot 409 and old writes 412 with durable candidates and successor IDs only for granted callers; unrelated recording unchanged. |
| `metadata-import-management` | real-api-browser | Partial | Browser `admin.spec.ts` (Chromium): copy-only import preview, per-item skip, approval, execution with files verified on disk, and write-back status (writers off, sidecar diff approval and write). Provider lookups do not exist; in-file writers remain off by decision; only the sidecar path was exercised. |
| `same-origin-fallback` | real-http | Partial | Go `webui` tests and `reader-isolation` routing checks (API/assets never get index.html, reader origin serves only reader files). The Vite development proxy was not tested; `PUBLIC_PATH_PREFIX` is not applied. |
| `accessibility-responsive` | real-browser | Partial | `a11y.spec.ts`: axe-core WCAG A/AA scan of the main screens in Chromium (clean after fixes: contrast theme, scroll-region focus, slider labels), keyboard reachability and dialog focus trap/release in Chromium and Firefox (skipped in WebKit, which does not Tab to buttons by default), narrow-width reflow checks. No screen-reader testing; axe cannot scan inside the reader iframe. |
| `format-corpus` | real-api-browser | Partial | `format.spec.ts` and `research/t005/format-matrix.md`: generated EPUB, KEPUB (no Kobo spans), fixed-layout, FB2, PDF, MOBI, AZW3, damaged EPUB, CBZ, hostile CBZ, CBR and MP3/M4A/M4B/OGG/Opus/FLAC/WAV in three browsers, each reaching an explicit state. CBR/CB7 unsupported; MOBI/AZW3 resume unverified; real-world files beyond synthetic fixtures untested. |
| `release-hold` | inspection | Covered | Inspection: no change under `.github`, `archive`, Android, `TASKS.md`, `AGENTS.md`, `contracts`; no tags, signing, publishing or CI activation; no legacy importer. |
