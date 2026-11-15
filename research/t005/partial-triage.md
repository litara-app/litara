# T005 partial scenarios: individual triage

Proposal for the owner's review. Nothing here is accepted or assigned. "T005" means required behavior that stays in this package; "Decision" means a policy or scope question that needs the owner; "T007" means hardware, NAS, Android or real-device acceptance that the T005 assignment defers. Sizes are rough (S = a test or two, M = a feature-sized change plus tests).

Of the 18 scenarios that were partial at the final review, nine are now covered (`grant-revocation`, `web-cookie-csrf`, `reader-bridge-forgery`, `annotation-format-matrix`, `scan-editions`, `edition-replacement`, `manual-ebook-finish`, `smart-viewer-state`, `archive-restart-cache`). Nine remain partial.

| Scenario | What is missing | Proposed owner | Size |
| --- | --- | --- | --- |
| `cfi-reflow` | FB2 and MOBI resume (reflow resume is now tested for EPUB in three browsers; the profile check is done). | T005 | S |
| `shared-shelf-permissions` | Automated browser test of the shelf screens (API coverage is thorough). | T005 | M |
| `shelf-concurrency` | A two-browser-tab race (the API race with a hidden member is now tested). | T005 | S |
| `audio-web-flow` | An audio position conflict in the browser. Natural-end completion is now tested (Chromium, Firefox); WebKit MP3 playback is a browser limit reported explicitly. | T005 | S |
| `repair-split` | Browser test of the split flow (API tested with competing plans). | T005 | M |
| `same-origin-fallback` | `PUBLIC_PATH_PREFIX` is not applied to web serving; the Vite development proxy with CSRF is untested. | T005 (the scenario is ADR-0069 behavior) | M |
| `metadata-import-management` | Browser tests of protected edits, clears and review lists (import and write-back status are covered). | T005 | M |
| `accessibility-responsive` | Screen-reader and real-device checks; axe cannot scan inside the cross-origin reader frame. | T007 for devices and screen readers; T005 may add checks of the reader controls | — |
| `format-corpus` | Real-world files (large, messy), KEPUB Kobo spans, MOBI/AZW3 resume, real compressed RAR files (CBR/CB7 now work on generated archives; ADR-0072 accepted). | T007 for real-world files | — |

## Notes
- The WebKit comic-navigation timeout seen in review did not reproduce: the comic spec passed 24 of 24 repeats in WebKit and in the final full run. It remains unexplained, so treat it as an intermittent unknown.
- The T003 repair additions are now in `contracts/t003/` (see the handoff), so they no longer wait on anyone.

## Decisions recorded (2026-11-15)
The owner chose: build PDF text selection (done, three browsers); implement the minimal engine-profile mismatch check (done); add a Mark-finished control to the reader menu (done); research CBR/CB7 libraries and propose (ADR-0072; the owner then chose CBR and CB7 together, MPL-2.0 acceptable, a 128 MiB dictionary ceiling and an in-repo RAR5 writer for fixtures, and the ADR is Accepted and implemented).
