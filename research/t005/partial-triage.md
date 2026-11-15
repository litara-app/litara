# T005 partial scenarios: individual triage

Proposal for the owner's review. Nothing here is accepted or assigned. "T005" means required behavior that stays in this package; "Decision" means a policy or scope question that needs the owner; "T007" means hardware, NAS, Android or real-device acceptance that the T005 assignment defers. Sizes are rough (S = a test or two, M = a feature-sized change plus tests).

Of the 18 scenarios that were partial at the final review, sixteen are now covered. Two remain partial, both deferred to T007 (screen-reader and real-device accessibility checks; real-world files).

| Scenario | What is missing | Proposed owner | Size |
| --- | --- | --- | --- |
| `accessibility-responsive` | Screen-reader and real-device checks; axe cannot scan inside the cross-origin reader frame. | T007 for devices and screen readers; T005 may add checks of the reader controls | — |
| `format-corpus` | Real-world files (large, messy), KEPUB Kobo spans, real compressed RAR5 or solid archives (CBR/CB7 work on generated archives and one real RAR4; MOBI/AZW3 resume is now tested on generated files). | T007 for real-world files | — |

## Notes
- The WebKit comic-navigation timeout seen in review did not reproduce: the comic spec passed 24 of 24 repeats in WebKit and in the final full run. It remains unexplained, so treat it as an intermittent unknown.
- The T003 repair additions are now in `contracts/t003/` (see the handoff), so they no longer wait on anyone.

## Decisions recorded (2026-11-15)
The owner chose: build PDF text selection (done, three browsers); implement the minimal engine-profile mismatch check (done); add a Mark-finished control to the reader menu (done); research CBR/CB7 libraries and propose (ADR-0072; the owner then chose CBR and CB7 together, MPL-2.0 acceptable, a 128 MiB dictionary ceiling and an in-repo RAR5 writer for fixtures, and the ADR is Accepted and implemented).

## Remaining T005 partials closed (2026-11-15)
Shelf permissions, the repair split, the T004 metadata/review screens and the same-origin fallback now have browser or real-HTTP evidence (see `research/t005/coverage.md`). The browser review of the metadata screens found a real server defect: reviews about an ebook or comic edition that looks like an existing title (`edition-title:` keys) could not be decided from the review list. They now accept keep-separate and link; deciding a title link from the edition page closes the review; the review screen offers only the actions that apply.
Serving the web app under a path prefix remains unimplemented. It would need a `<base>` element and therefore a CSP change (`base-uri` is `none`); that is an architectural choice that needs its own ADR, so it was not done.
